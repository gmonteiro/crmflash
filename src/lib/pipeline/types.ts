import type { CommitmentSignalType, StageEventDirection } from "@/types/database"

// Snapshot do pipeline: tudo que as derivações (métricas e copiloto) precisam,
// buscado de uma vez só. Os tipos abaixo são subsets das linhas do banco —
// só as colunas que as derivações realmente leem.

export interface SnapshotColumn {
  id: string
  title: string
  color: string
  position: number
}

export interface SnapshotCompany {
  id: string
  name: string
  kanban_column_id: string
  kanban_position: number | null
  last_client_event_at: string | null
  champion_name: string | null
  economic_buyer_name: string | null
  pain_hypothesis: string | null
}

export interface SnapshotStageEvent {
  company_id: string
  from_title: string | null
  to_title: string | null
  to_column_id: string | null
  to_position: number | null
  direction: StageEventDirection
  occurred_at: string
}

export interface SnapshotSignal {
  company_id: string
  signal_type: CommitmentSignalType
  captured_at: string
}

export interface SnapshotNextStep {
  id: string
  company_id: string
  title: string
  due_date: string | null
  status: "pending" | "completed"
}

export interface SnapshotActivity {
  id: string
  company_id: string | null
  type: string
  title: string
  date: string
}

export interface SnapshotPerson {
  id: string
  company_id: string | null
  full_name: string
}

export interface PipelineSnapshot {
  now: Date
  columns: SnapshotColumn[]
  companies: SnapshotCompany[]
  events: SnapshotStageEvent[]
  signals: SnapshotSignal[]
  nextSteps: SnapshotNextStep[] // só pendentes
  activities: SnapshotActivity[] // vazio quando includeActivities = false
  people: SnapshotPerson[] // vazio quando includePeople = false
}
