import type { SupabaseClient } from "@supabase/supabase-js"
import type { ReviewResolution } from "@/types/copilot"

// As duas decisões que só você toma: aceitar/recusar uma proposta da IA e
// resolver um caso da fila de identidade. Chamadas pelo copiloto (applyEffect,
// com o cliente do usuário e RLS) e pelas tools do MCP.

export interface DecisionContext {
  workspaceId: string
  userId: string | null
}

const CONTEXT_FIELDS: Record<string, "champion_name" | "economic_buyer_name" | "pain_hypothesis"> = {
  champion: "champion_name",
  economic_buyer: "economic_buyer_name",
  pain_hypothesis: "pain_hypothesis",
}

export interface DecisionResult {
  ok: boolean
  detail: string
}

/**
 * Aceitar uma proposta de campo grava o valor e aponta context_inference_ids
 * para ela. Aceitar uma sugestão de ESTÁGIO só marca a proposta: quem move o
 * card é o efeito move_stage que vem junto na mesma ação (rules.ts) — este
 * módulo nunca move estágio.
 */
export async function decideInference(
  supabase: SupabaseClient,
  ctx: DecisionContext,
  inferenceId: string,
  decision: "accept" | "reject"
): Promise<DecisionResult> {
  const { data: inf, error } = await supabase
    .from("inferences")
    .select("id, company_id, field, value, status, source_activity_id")
    .eq("id", inferenceId)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle()
  if (error || !inf) return { ok: false, detail: "proposta não encontrada" }
  if (inf.status !== "proposed") return { ok: false, detail: `proposta já está ${inf.status}` }

  if (decision === "accept" && String(inf.field).startsWith("next_step:")) {
    // Passo que a IA viu numa reunião já revisada por você (policy.ts). A
    // chave é a própria inferência: aceitar duas vezes cai no UNIQUE.
    const v = (inf.value ?? {}) as { title?: string; due_date?: string | null; assignee?: string | null }
    if (!v.title) return { ok: false, detail: "proposta sem título" }
    const { error: stepErr } = await supabase.from("company_next_steps").insert({
      workspace_id: ctx.workspaceId,
      user_id: ctx.userId,
      company_id: inf.company_id,
      title: v.title,
      due_date: v.due_date ?? null,
      description: v.assignee ? `Responsável: ${v.assignee}` : null,
      status: "pending",
      source_ref: `inf:${inf.id}`,
      inference_id: inf.id,
      source_activity_id: inf.source_activity_id ?? null,
    })
    if (stepErr && stepErr.code !== "23505") return { ok: false, detail: stepErr.message }
  }

  if (decision === "accept" && CONTEXT_FIELDS[inf.field]) {
    const column = CONTEXT_FIELDS[inf.field]
    const value = (inf.value as { value?: string })?.value
    if (!value) return { ok: false, detail: "proposta sem valor" }
    const { data: company } = await supabase
      .from("companies")
      .select("context_inference_ids")
      .eq("id", inf.company_id)
      .maybeSingle()
    const ids = { ...((company?.context_inference_ids as Record<string, string>) ?? {}), [column]: inf.id }
    const { error: upErr } = await supabase
      .from("companies")
      .update({ [column]: value, context_inference_ids: ids })
      .eq("id", inf.company_id)
      .eq("workspace_id", ctx.workspaceId)
    if (upErr) return { ok: false, detail: upErr.message }
  }

  const { error: stErr } = await supabase
    .from("inferences")
    .update({
      status: decision === "accept" ? "applied" : "rejected",
      decided_by: ctx.userId,
      decided_at: new Date().toISOString(),
    })
    .eq("id", inferenceId)
  if (stErr) return { ok: false, detail: stErr.message }
  return { ok: true, detail: `${inf.field}: ${decision === "accept" ? "aceita" : "recusada"}` }
}

interface ReviewObserved {
  email?: string
  domain?: string
  name?: string | null
  meeting_id?: string
  /** Contato revisado no TranscriptionApp (reviewed-fields.ts): a atividade da reunião. */
  activity_id?: string
  /** WhatsApp: telefone E.164 (caso whatsapp_contato). */
  phone?: string
  /** WhatsApp: grupo (caso grupo_sem_empresa). */
  group_id?: string
  group_name?: string | null
}

/**
 * Resolver grava a identidade como 'confirmed' (ou o domínio), e a mesma
 * observação passa a cair no degrau 1 da escada: a pergunta não volta.
 * Reunião sem empresa não se resolve aqui — precisa reingerir a transcrição,
 * o que é a tool attach_transcript.
 */
export async function resolveReview(
  supabase: SupabaseClient,
  ctx: DecisionContext,
  reviewId: string,
  resolution: ReviewResolution
): Promise<DecisionResult> {
  const { data: review, error } = await supabase
    .from("identity_reviews")
    .select("id, reason, observed, status, company_id")
    .eq("id", reviewId)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle()
  if (error || !review) return { ok: false, detail: "caso não encontrado" }
  if (review.status !== "open") return { ok: false, detail: `caso já está ${review.status}` }
  const obs = (review.observed ?? {}) as ReviewObserved

  // A chave do caso: e-mail (Gmail, Calendar) ou telefone (WhatsApp).
  const key = obs.email ? { kind: "email", value: obs.email } : obs.phone ? { kind: "phone", value: obs.phone } : null
  const identity = (personId: string | null, ignored: boolean) =>
    supabase.from("person_identities").upsert(
      {
        workspace_id: ctx.workspaceId,
        person_id: personId,
        ignored,
        kind: key!.kind,
        value_norm: key!.value,
        value_raw: key!.value,
        source: "review",
        confidence: "confirmed",
      },
      { onConflict: "workspace_id,kind,value_norm" }
    )
  const domainRow = (companyId: string | null, ignored: boolean) =>
    supabase.from("company_domains").upsert(
      { workspace_id: ctx.workspaceId, domain: obs.domain, company_id: companyId, ignored, source: "review" },
      { onConflict: "workspace_id,domain" }
    )
  const groupRow = (companyId: string | null, ignored: boolean) =>
    supabase.from("whatsapp_group_companies").upsert(
      {
        workspace_id: ctx.workspaceId,
        group_id: obs.group_id,
        group_name: obs.group_name ?? null,
        company_id: companyId,
        ignored,
        source: "review",
      },
      { onConflict: "workspace_id,group_id" }
    )

  let write: { error: { message: string } | null } = { error: null }
  let detail = ""

  switch (resolution.type) {
    case "link_person": {
      if (key) {
        write = await identity(resolution.personId, false)
        detail = `${key.value} → pessoa ${resolution.personId}`
      } else if (obs.activity_id) {
        // Contato só com nome (TranscriptionApp): não há chave para gravar;
        // a escolha liga a pessoa à reunião em que apareceu.
        write = await supabase.from("activity_participants").upsert(
          { workspace_id: ctx.workspaceId, activity_id: obs.activity_id, person_id: resolution.personId, role: "attendee" },
          { onConflict: "activity_id,person_id,role", ignoreDuplicates: true }
        )
        detail = `${obs.name ?? "contato"} → pessoa ${resolution.personId}`
      } else {
        return { ok: false, detail: "o caso não tem e-mail para ligar" }
      }
      break
    }
    case "link_company": {
      if (obs.group_id) {
        write = await groupRow(resolution.companyId, false)
        detail = `grupo ${obs.group_name ?? obs.group_id} → empresa ${resolution.companyId}`
        break
      }
      if (!obs.domain) return { ok: false, detail: "o caso não tem domínio para ligar" }
      write = await domainRow(resolution.companyId, false)
      detail = `${obs.domain} → empresa ${resolution.companyId}`
      break
    }
    case "create_company": {
      if (!obs.domain && !obs.group_id) return { ok: false, detail: "o caso não tem domínio" }
      const { data: created, error: cErr } = await supabase
        .from("companies")
        .insert({ workspace_id: ctx.workspaceId, user_id: ctx.userId, name: resolution.name.trim(), domain: obs.domain ?? null })
        .select("id")
        .single()
      if (cErr) return { ok: false, detail: cErr.message }
      write = obs.group_id ? await groupRow(created.id, false) : await domainRow(created.id, false)
      detail = `empresa "${resolution.name}" criada${obs.group_id ? ` para o grupo ${obs.group_name ?? obs.group_id}` : ` com ${obs.domain}`}`
      break
    }
    case "ignore": {
      if (obs.group_id) write = await groupRow(null, true)
      else if (review.reason === "dominio_desconhecido" && obs.domain) write = await domainRow(null, true)
      else if (key) write = await identity(null, true)
      detail = "ignorado"
      break
    }
  }
  if (write.error) return { ok: false, detail: write.error.message }

  const { error: rErr } = await supabase
    .from("identity_reviews")
    .update({
      status: resolution.type === "ignore" ? "ignored" : "resolved",
      resolution,
      resolved_by: ctx.userId,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", reviewId)
  if (rErr) return { ok: false, detail: rErr.message }
  return { ok: true, detail }
}
