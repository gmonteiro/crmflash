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
