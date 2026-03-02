import { z } from 'zod'

export const personSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  linkedin_url: z.string().url('Invalid URL').optional().or(z.literal('')),
  current_title: z.string().optional().or(z.literal('')),
  current_company: z.string().optional().or(z.literal('')),
  company_id: z.string().uuid().optional().nullable(),
  category: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
})

export type PersonFormData = z.infer<typeof personSchema>

export const companySchema = z.object({
  name: z.string().min(1, 'Company name is required'),
  domain: z.string().optional().or(z.literal('')),
  linkedin_url: z.string().url('Invalid URL').optional().or(z.literal('')),
  industry: z.string().optional().or(z.literal('')),
  size_tier: z.enum(['Micro', 'Small', 'Medium', 'Large', 'Enterprise']).optional().nullable(),
  estimated_revenue: z.number().optional().nullable(),
  employee_count: z.number().int().optional().nullable(),
  description: z.string().optional().or(z.literal('')),
  website: z.string().url('Invalid URL').optional().or(z.literal('')),
})

export type CompanyFormData = z.infer<typeof companySchema>

export const kanbanColumnSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color'),
})

export type KanbanColumnFormData = z.infer<typeof kanbanColumnSchema>

export const activitySchema = z.object({
  type: z.enum(['meeting', 'call', 'email', 'note']),
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional().or(z.literal('')),
  date: z.string().min(1, 'Date is required'),
})

export type ActivityFormData = z.infer<typeof activitySchema>

export const nextStepSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional().or(z.literal('')),
  due_date: z.string().optional().or(z.literal('')),
})

export type NextStepFormData = z.infer<typeof nextStepSchema>

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const integrationActivitySchema = z.object({
  person_id: z.string().regex(uuidRegex, 'Invalid UUID').optional().nullable(),
  company_id: z.string().regex(uuidRegex, 'Invalid UUID').optional().nullable(),
  title: z.string().min(1).max(500),
  date: z.string().optional(),
  source_meeting_id: z.string().max(500).optional().nullable(),
  source_app_url: z.string().url().max(2000).optional().nullable(),
  transcript: z.string().max(500000).optional().nullable(),
  summary: z.any().optional().nullable(),
  speakers: z.any().optional().nullable(),
  audio_url: z.string().url().max(2000).optional().nullable(),
}).refine(data => data.person_id || data.company_id, {
  message: 'At least one of person_id or company_id is required',
})

export type IntegrationActivityData = z.infer<typeof integrationActivitySchema>

export const documentUploadSchema = z.object({
  doc_type: z.enum(['contract', 'proposal', 'invoice', 'report', 'other']),
  description: z.string().optional().or(z.literal('')),
})
