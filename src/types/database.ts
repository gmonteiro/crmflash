export type SizeTier = 'Micro' | 'Small' | 'Medium' | 'Large' | 'Enterprise'

export type ImportStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface Company {
  id: string
  workspace_id: string
  user_id: string | null // quem criou; o escopo e workspace_id
  name: string
  domain: string | null
  linkedin_url: string | null
  industry: string | null
  size_tier: SizeTier | null
  estimated_revenue: number | null
  employee_count: number | null
  description: string | null
  logo_url: string | null
  website: string | null
  metadata: Record<string, unknown> | null
  kanban_column_id: string | null
  kanban_position: number | null
  // Pipeline (migration 008)
  champion_name: string | null
  economic_buyer_name: string | null
  pain_hypothesis: string | null
  last_client_event_at: string | null
  created_at: string
  updated_at: string
}

export type CommitmentSignalType =
  | 'second_interlocutor'
  | 'presented_internally'
  | 'shared_real_data'
  | 'allocated_team_member'
  | 'asked_price'
  | 'security_process'

export interface CommitmentSignal {
  id: string
  workspace_id: string
  user_id: string | null // quem criou; o escopo e workspace_id
  company_id: string
  signal_type: CommitmentSignalType
  captured_at: string
  created_at: string
}

export type StageEventDirection = 'enter' | 'advance' | 'retreat' | 'frozen'

export interface CompanyStageEvent {
  id: string
  workspace_id: string
  user_id: string | null // quem criou; o escopo e workspace_id
  company_id: string
  from_column_id: string | null
  to_column_id: string | null
  from_title: string | null
  to_title: string | null
  from_position: number | null
  to_position: number | null
  direction: StageEventDirection
  occurred_at: string
  created_at: string
}

export interface Person {
  id: string
  workspace_id: string
  user_id: string | null // quem criou; o escopo e workspace_id
  first_name: string
  last_name: string
  full_name: string
  email: string | null
  phone: string | null
  linkedin_url: string | null
  current_title: string | null
  current_company: string | null
  company_id: string | null
  category: string | null
  notes: string | null
  avatar_url: string | null
  linkedin_enriched_at: string | null
  linkedin_raw_data: Record<string, unknown> | null
  kanban_column_id: string | null
  kanban_position: number | null
  created_at: string
  updated_at: string
  // Joined
  company?: Company | null
  tags?: Tag[]
}

export interface KanbanColumn {
  id: string
  workspace_id: string
  user_id: string | null // quem criou; o escopo e workspace_id
  title: string
  color: string
  position: number
  created_at: string
  updated_at: string
}

export interface ImportHistory {
  id: string
  workspace_id: string
  user_id: string | null // quem criou; o escopo e workspace_id
  filename: string
  file_type: 'csv' | 'xlsx'
  row_count: number
  success_count: number
  error_count: number
  column_mapping: Record<string, string> | null
  errors: Record<string, unknown>[] | null
  status: ImportStatus
  created_at: string
  completed_at: string | null
}

export interface Tag {
  id: string
  workspace_id: string
  user_id: string | null // quem criou; o escopo e workspace_id
  name: string
  color: string | null
  created_at: string
}

export interface PersonTag {
  person_id: string
  tag_id: string
}

export type DocumentType = 'contract' | 'proposal' | 'invoice' | 'report' | 'other'
export type ActivityType = 'meeting' | 'call' | 'email' | 'note' | 'document_uploaded' | 'next_step_created'
export type NextStepStatus = 'pending' | 'completed'

export interface CompanyDocument {
  id: string
  workspace_id: string
  user_id: string | null // quem criou; o escopo e workspace_id
  company_id: string
  name: string
  file_path: string
  file_size: number
  mime_type: string
  doc_type: DocumentType
  description: string | null
  created_at: string
  updated_at: string
}

export interface CompanyActivity {
  id: string
  workspace_id: string
  user_id: string | null // quem criou; o escopo e workspace_id
  company_id: string
  type: ActivityType
  title: string
  description: string | null
  date: string
  created_at: string
}

export type ActivitySource = 'manual' | 'transcription_app'

export interface Activity {
  id: string
  workspace_id: string
  user_id: string | null // quem criou; o escopo e workspace_id
  person_id: string | null
  company_id: string | null
  type: 'meeting' | 'call' | 'email' | 'note'
  title: string
  date: string
  description: string | null
  source: ActivitySource
  source_meeting_id: string | null
  source_app_url: string | null
  transcript: string | null
  summary: {
    executive_summary?: string
    key_findings?: string[]
    challenges?: string[]
    opportunities?: string[]
    action_items?: string[]
  } | null
  speakers: {
    label: string
    name: string | null
    utterances: { text: string }[]
  }[] | null
  audio_url: string | null
  created_at: string
  updated_at: string
  // Joined
  person?: { id: string; full_name: string } | null
  company?: { id: string; name: string } | null
}

export type ShortlistEntityType = 'person' | 'company'

export interface Shortlist {
  id: string
  workspace_id: string
  user_id: string | null // quem criou; o escopo e workspace_id
  entity_type: ShortlistEntityType
  name: string
  description: string | null
  created_at: string
  updated_at: string
  member_count?: number
}

export interface ShortlistMember {
  id: string
  shortlist_id: string
  person_id: string | null
  company_id: string | null
  added_at: string
  // Joined
  person?: Person | null
  company?: Company | null
}

export interface CompanyNextStep {
  id: string
  workspace_id: string
  user_id: string | null // quem criou; o escopo e workspace_id
  company_id: string
  title: string
  description: string | null
  due_date: string | null
  status: NextStepStatus
  completed_at: string | null
  created_at: string
  updated_at: string
  // Joined (for calendar)
  company?: { id: string; name: string } | null
}

// Copiloto (migration 009). As perguntas são derivadas do estado do board; o que
// persiste é a resposta, que também serve de supressão até suppress_until.
export type CopilotEventStatus = 'answered' | 'snoozed' | 'dismissed'

export interface CopilotQuestionEvent {
  id: string
  workspace_id: string
  user_id: string | null // quem criou; o escopo e workspace_id
  company_id: string
  question_key: string
  rule_id: string
  status: CopilotEventStatus
  action_id: string | null
  answer_text: string | null
  applied: Record<string, unknown> | null
  suppress_until: string
  created_at: string
}

// ---------------------------------------------------------------------------
// Workspaces (migration 010)
// ---------------------------------------------------------------------------

export interface Workspace {
  id: string
  name: string
  created_by: string
  created_at: string
}

export interface WorkspaceMember {
  id: string
  workspace_id: string
  user_id: string
  joined_at: string
}

export type InvitationStatus = 'pending' | 'accepted' | 'declined'

export interface WorkspaceInvitation {
  id: string
  workspace_id: string
  invited_email: string
  invited_by: string
  status: InvitationStatus
  created_at: string
}
