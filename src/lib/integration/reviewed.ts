import type { SupabaseClient } from "@supabase/supabase-js"
import { applyReviewedFields, type ReviewedFieldsInput, type ReviewedFieldsResult } from "@/lib/hub/reviewed-fields"
import { SupabaseHubStore } from "@/lib/hub/supabase-store"
import { internalDomains } from "@/lib/identity/normalize"

// A ponte entre as rotas /api/integration/* e o hub: os campos que você
// revisou no TranscriptionApp entram pelo mesmo store (service role) que o
// cron usa, no workspace do INTEGRATION_USER_ID e com ele como autor.

export interface ReviewedOutcome {
  result: ReviewedFieldsResult | null
  /** O hub falhou (ex.: migração 021 ausente). A atividade já foi gravada; os campos não. */
  error: string | null
}

export async function applyReviewedFromIntegration(
  db: SupabaseClient,
  ctx: { workspaceId: string; userId: string },
  input: ReviewedFieldsInput
): Promise<ReviewedOutcome> {
  try {
    const store = new SupabaseHubStore(db, ctx.workspaceId, ctx.userId)
    return { result: await applyReviewedFields(store, input, internalDomains()), error: null }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("Integração: campos revisados não aplicados:", message)
    return { result: null, error: message }
  }
}

/**
 * A atividade desta reunião nesta empresa. Pode haver duas — a que esta rota
 * criou e o meeting.held do hub, que também é source = transcription_app —,
 * então pega a mais antiga em vez de maybeSingle(), que erra com duas linhas
 * e fazia o reenvio criar uma terceira.
 */
export async function findMeetingActivity(
  db: SupabaseClient,
  workspaceId: string,
  meetingId: string,
  target: { personId: string | null; companyId: string | null }
): Promise<{ id: string; created_at: string; date: string | null } | null> {
  let q = db
    .from("activities")
    .select("id, created_at, date")
    .eq("workspace_id", workspaceId)
    .eq("source", "transcription_app")
    .eq("source_meeting_id", meetingId)
  q = target.personId ? q.eq("person_id", target.personId) : q.is("person_id", null)
  q = target.companyId ? q.eq("company_id", target.companyId) : q.is("company_id", null)
  const { data } = await q.order("created_at", { ascending: true }).limit(1)
  return (data?.[0] as { id: string; created_at: string; date: string | null } | undefined) ?? null
}
