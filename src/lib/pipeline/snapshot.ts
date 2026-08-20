import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  PipelineSnapshot,
  SnapshotActivity,
  SnapshotColumn,
  SnapshotCompany,
  SnapshotNextStep,
  SnapshotPerson,
  SnapshotSignal,
  SnapshotStageEvent,
} from "./types"
import { MS_PER_DAY } from "./stages"

// Limite explícito: o Supabase corta em 1000 linhas por padrão, o que faria as
// métricas mentirem silenciosamente quando o log de eventos crescer.
const ROW_LIMIT = 5000

interface SnapshotOptions {
  includeActivities?: boolean
  activityDays?: number
  includePeople?: boolean
}

// Busca de uma vez tudo que as derivações do pipeline precisam. As leituras
// dependem de RLS (user_id = auth.uid()), como no resto do app.
export async function fetchPipelineSnapshot(
  supabase: SupabaseClient,
  opts: SnapshotOptions = {}
): Promise<PipelineSnapshot> {
  const { includeActivities = false, activityDays = 7, includePeople = false } = opts
  const now = new Date()

  const [colsRes, companiesRes, eventsRes, signalsRes, stepsRes] = await Promise.all([
    supabase
      .from("kanban_columns")
      .select("id, title, color, position")
      .order("position")
      .limit(ROW_LIMIT),
    supabase
      .from("companies")
      .select(
        "id, name, kanban_column_id, kanban_position, last_client_event_at, champion_name, economic_buyer_name, pain_hypothesis"
      )
      .not("kanban_column_id", "is", null)
      .limit(ROW_LIMIT),
    supabase
      .from("company_stage_events")
      .select("company_id, from_title, to_title, to_column_id, to_position, direction, occurred_at")
      .order("occurred_at", { ascending: true })
      .limit(ROW_LIMIT),
    supabase
      .from("company_commitment_signals")
      .select("company_id, signal_type, captured_at")
      .limit(ROW_LIMIT),
    supabase
      .from("company_next_steps")
      .select("id, company_id, title, due_date, status")
      .eq("status", "pending")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(ROW_LIMIT),
  ])

  let activities: SnapshotActivity[] = []
  if (includeActivities) {
    const since = new Date(now.getTime() - activityDays * MS_PER_DAY).toISOString()
    const { data } = await supabase
      .from("activities")
      .select("id, company_id, type, title, date")
      .not("company_id", "is", null)
      .gte("date", since)
      .order("date", { ascending: false })
      .limit(ROW_LIMIT)
    activities = (data ?? []) as SnapshotActivity[]
  }

  let people: SnapshotPerson[] = []
  if (includePeople) {
    const { data } = await supabase
      .from("people")
      .select("id, company_id, full_name")
      .not("company_id", "is", null)
      .limit(ROW_LIMIT)
    people = (data ?? []) as SnapshotPerson[]
  }

  return {
    now,
    columns: (colsRes.data ?? []) as SnapshotColumn[],
    companies: (companiesRes.data ?? []) as SnapshotCompany[],
    events: (eventsRes.data ?? []) as SnapshotStageEvent[],
    signals: (signalsRes.data ?? []) as SnapshotSignal[],
    nextSteps: (stepsRes.data ?? []) as SnapshotNextStep[],
    activities,
    people,
  }
}
