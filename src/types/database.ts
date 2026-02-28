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
