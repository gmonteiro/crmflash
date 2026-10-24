import { z } from "zod"
import { resolveReview } from "@/lib/hub/decisions"
import { ClaudeExtractor } from "@/lib/hub/extraction"
import { linkProjectAndReingest } from "@/lib/hub/projects"
import { ingestMeeting } from "@/lib/hub/transcript-ingest"
import { internalDomains } from "@/lib/identity/normalize"
import { TranscriptionAppClient } from "@/lib/transcription/client"
import type { ReviewResolution } from "@/types/copilot"
import type { McpTool } from "../../registry"
import { serviceStoreFor } from "./service-store"

const listInput = z.object({ limit: z.number().int().min(1).max(100).default(20) })

export const listIdentityReviews: McpTool<typeof listInput> = {
  name: "list_identity_reviews",
  description:
    "A fila de casos que a resolução de identidade não decidiu sozinha: e-mail de domínio " +
    "desconhecido, homônimos na mesma empresa, e-mail pessoal (gmail etc.), reunião sem " +
    "convite ou sem empresa, projeto do TranscriptionApp ainda sem empresa, contato e grupo do " +
    "WhatsApp (só nome e número; a mensagem fica no PC até você confirmar). Cada caso traz o que foi observado e os candidatos. Resolva " +
    "com resolve_identity.",
  input: listInput,
  async handler({ supabase }, { limit }) {
    const { data, error } = await supabase
      .from("identity_reviews")
      .select("id, reason, observed, candidates, company_id, created_at")
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .limit(limit)
    if (error) throw new Error(`Não consegui ler a fila: ${error.message}`)
    return { open: data ?? [] }
  },
}

const resolveInput = z.object({
  review_id: z.string().uuid(),
  action: z
    .enum(["link_person", "link_company", "create_company", "ignore"])
    .describe(
      "link_person: o e-mail (ou o telefone do WhatsApp) é desta pessoa. link_company: o domínio " +
        "(ou a reunião, o projeto do TranscriptionApp, o grupo do WhatsApp) é desta empresa. create_company: cria a empresa com este " +
        "domínio (ou para este projeto). ignore: não é contato comercial (projeto: é interno)."
    ),
  person_id: z.string().uuid().nullable().default(null),
  company_id: z.string().uuid().nullable().default(null),
  company_name: z.string().trim().min(1).nullable().default(null),
})

function toResolution(args: z.infer<typeof resolveInput>): ReviewResolution | null {
  switch (args.action) {
    case "link_person":
      return args.person_id ? { type: "link_person", personId: args.person_id } : null
    case "link_company":
      return args.company_id ? { type: "link_company", companyId: args.company_id } : null
    case "create_company":
      return args.company_name ? { type: "create_company", name: args.company_name } : null
    case "ignore":
      return { type: "ignore" }
  }
}

export const resolveIdentityReview: McpTool<typeof resolveInput> = {
  name: "resolve_identity",
  description:
    "Resolve um caso da fila de identidade. A resposta vira identidade confirmada, então o " +
    "mesmo e-mail ou domínio não volta para a fila. Confirme com a pessoa antes: ligar o " +
    "domínio errado a uma empresa contamina todos os e-mails futuros dele.",
  input: resolveInput,
  async handler(identity, args) {
    const { supabase, workspaceId, userId } = identity
    const { data: review } = await supabase
      .from("identity_reviews")
      .select("id, observed, status")
      .eq("id", args.review_id)
      .maybeSingle()
    if (!review) throw new Error("Caso não encontrado.")
    if (review.status !== "open") throw new Error(`Caso já está ${review.status}.`)

    // Projeto do TranscriptionApp: liga o projeto inteiro e reprocessa as reuniões dele.
    const project = review.observed as { project_id?: string; project_name?: string | null } | null
    if (project?.project_id) {
      let target: { companyId: string } | { ignored: true }
      if (args.action === "link_company") {
        if (!args.company_id) throw new Error("link_company exige company_id.")
        target = { companyId: args.company_id }
      } else if (args.action === "create_company") {
        const name = args.company_name ?? project.project_name
        if (!name) throw new Error("create_company exige company_name.")
        const { data: created, error } = await supabase
          .from("companies")
          .insert({ workspace_id: workspaceId, user_id: userId, name: name.trim() })
          .select("id")
          .single()
        if (error) throw new Error(`Não consegui criar a empresa: ${error.message}`)
        target = { companyId: created.id as string }
      } else if (args.action === "ignore") {
        target = { ignored: true }
      } else {
        throw new Error("Projeto se resolve com link_company, create_company ou ignore.")
      }
      const store = await serviceStoreFor(identity)
      const meetings = await linkProjectAndReingest(
        store,
        new TranscriptionAppClient(),
        new ClaudeExtractor(),
        internalDomains(),
        { id: project.project_id, name: project.project_name ?? null },
        target
      )
      await supabase
        .from("identity_reviews")
        .update({
          status: "resolved",
          resolution: "ignored" in target ? { type: "ignore" } : { type: "link_company", companyId: target.companyId },
          resolved_by: userId,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", args.review_id)
      return {
        ok: true,
        project: project.project_name,
        meetings: meetings.map((m) => ({ id: m.meetingId, status: m.status, companies: m.companies, extracted: m.extracted })),
      }
    }

    // Reunião sem convite/empresa: resolver é reingerir a transcrição na empresa escolhida.
    const meetingId = (review.observed as { meeting_id?: string } | null)?.meeting_id
    if (meetingId && args.action === "link_company") {
      if (!args.company_id) throw new Error("link_company exige company_id.")
      const store = await serviceStoreFor(identity)
      const meeting = await ingestMeeting(
        store,
        new TranscriptionAppClient(),
        new ClaudeExtractor(),
        meetingId,
        internalDomains(),
        { forceCompanyId: args.company_id }
      )
      await supabase
        .from("identity_reviews")
        .update({
          status: "resolved",
          resolution: { type: "link_company", companyId: args.company_id },
          resolved_by: userId,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", args.review_id)
      return { ok: true, meeting }
    }

    const resolution = toResolution(args)
    if (!resolution) throw new Error(`${args.action} exige o id ou o nome correspondente.`)

    const out = await resolveReview(supabase, { workspaceId, userId }, args.review_id, resolution)
    if (!out.ok) throw new Error(out.detail)
    return { ok: true, detail: out.detail, next: "Rode sync_now para religar convites que esperavam este caso." }
  },
}
