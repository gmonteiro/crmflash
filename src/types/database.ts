export type SizeTier = 'Micro' | 'Small' | 'Medium' | 'Large' | 'Enterprise'

export type ImportStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface Company {
  id: string
  user_id: string
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
  created_at: string
  updated_at: string
}

export interface Person {
  id: string
  user_id: string
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
  user_id: string
  title: string
  color: string
  position: number
  created_at: string
  updated_at: string
}

export interface ImportHistory {
  id: string
  user_id: string
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
  user_id: string
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
  user_id: string
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
  user_id: string
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
  user_id: string
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

export interface CompanyNextStep {
  id: string
  user_id: string
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
