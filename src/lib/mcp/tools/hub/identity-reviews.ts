import { z } from "zod"
import { resolveReview } from "@/lib/hub/decisions"
import { ClaudeExtractor } from "@/lib/hub/extraction"
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
    "convite ou sem empresa. Cada caso traz o que foi observado e os candidatos. Resolva " +
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
      "link_person: o e-mail é desta pessoa. link_company: o domínio (ou a reunião) é desta " +
        "empresa. create_company: cria a empresa com este domínio. ignore: não é contato comercial."
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
