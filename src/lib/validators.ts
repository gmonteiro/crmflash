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

// Os seis sinais de compromisso (company_commitment_signals.signal_type).
export const commitmentSignalEnum = z.enum([
  'second_interlocutor',
  'presented_internally',
  'shared_real_data',
  'allocated_team_member',
  'asked_price',
  'security_process',
])

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD')
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`)
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d
  }, 'Data inválida')

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null))

// Campos que você revisou no TranscriptionApp antes de mandar (todos opcionais).
export const integrationNextStepItemSchema = z.object({
  title: z.string().trim().min(1).max(500),
  due_date: isoDate.nullable().optional().transform((v) => v ?? null),
  assignee: optionalText(200),
  source_action_item_id: optionalText(100),
})

export const integrationSignalItemSchema = z.object({
  type: commitmentSignalEnum,
  evidence: optionalText(1000),
})

export const integrationContactItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  role: optionalText(200),
  email: z
    .union([z.literal(''), z.string().trim().email().max(320)])
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
})

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
  next_steps: z.array(integrationNextStepItemSchema).max(50).optional(),
  signals: z.array(integrationSignalItemSchema).max(6).optional(),
  contacts: z.array(integrationContactItemSchema).max(50).optional(),
}).refine(data => data.person_id || data.company_id, {
  message: 'At least one of person_id or company_id is required',
})

// Pendência mandada depois da reunião (POST /api/integration/next-steps).
export const integrationNextStepsSchema = z.object({
  company_id: z.string().regex(uuidRegex, 'Invalid UUID'),
  source_meeting_id: z.string().min(1).max(500),
  next_steps: z.array(integrationNextStepItemSchema).min(1).max(50),
})

export type IntegrationActivityData = z.infer<typeof integrationActivitySchema>

export const documentUploadSchema = z.object({
  doc_type: z.enum(['contract', 'proposal', 'invoice', 'report', 'other']),
  description: z.string().optional().or(z.literal('')),
})

// ---------------------------------------------------------------------------
// Copiloto
// ---------------------------------------------------------------------------

export const copilotInterpretRequestSchema = z.object({
  companyId: z.string().regex(uuidRegex, 'Invalid UUID'),
  questionKey: z.string().min(1).max(200),
  ruleId: z.string().min(1).max(50),
  questionTitle: z.string().max(500),
  narration: z.string().min(3).max(4000),
})

export type CopilotInterpretRequest = z.infer<typeof copilotInterpretRequestSchema>

// O prompt manda o modelo usar "title", mas modelo nenhum obedece 100% do tempo:
// se ele inventar outro nome de chave a proposta inteira era descartada e o
// usuário via "não consegui interpretar". Aqui só renomeamos — nada é inventado,
// e um objeto sem nenhum texto aproveitável continua falhando na validação.
const NEXT_STEP_TITLE_ALIASES = ['description', 'task', 'titulo', 'título', 'name', 'step']

function normalizeNextStep(value: unknown): unknown {
  // Alguns retornos vêm como lista quando a narração cita mais de um compromisso.
  // Ficamos com o primeiro: o schema aceita um passo só, e propor o errado é pior
  // que propor menos — o usuário confirma item a item de qualquer jeito.
  const raw = Array.isArray(value) ? (value.length > 0 ? value[0] : null) : value
  if (!raw || typeof raw !== 'object') return raw

  const obj = raw as Record<string, unknown>
  const title =
    typeof obj.title === 'string'
      ? obj.title
      : obj[NEXT_STEP_TITLE_ALIASES.find((key) => typeof obj[key] === 'string') ?? '']

  // Uma data em formato inesperado ("2026-08-21T00:00:00", "amanhã") não pode
  // derrubar o passo inteiro: aproveitamos o prefixo ISO quando existe e, quando
  // não existe, ficamos sem data — o usuário preenche na hora de confirmar.
  const due = typeof obj.due_date === 'string' ? obj.due_date.slice(0, 10) : null
  const due_date = due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null

  return { ...obj, title, due_date }
}

// Sinal fora da lista é descartado, não invalida a proposta. O modelo às vezes
// inventa um rótulo em português; perder um sinal é bem melhor que perder tudo.
function dropUnknownSignals(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  const allowed = commitmentSignalEnum.options as readonly string[]
  return value.filter((item) => typeof item === 'string' && allowed.includes(item))
}

// Saída do modelo. Tudo tem default para que uma resposta parcial ainda valide —
// o que o modelo omitir vira "não afirmou nada sobre isso".
export const copilotUpdateProposalSchema = z.object({
  summary: z.string().max(500).default(''),
  client_event_today: z.boolean().default(false),
  stage_move: z
    .enum(['none', 'advance', 'retreat', 'frozen', 'won', 'lost'])
    .catch('none')
    .default('none'),
  stage_target_title: z.string().max(100).nullable().default(null),
  commitment_signals: z
    .preprocess(dropUnknownSignals, z.array(commitmentSignalEnum).max(6))
    .default([]),
  next_step: z
    .preprocess(
      normalizeNextStep,
      z
        .object({
          title: z.string().min(1).max(300),
          due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
        })
        .nullable()
    )
    .default(null),
  fields: z
    .object({
      champion_name: z.string().max(200).nullable().default(null),
      economic_buyer_name: z.string().max(200).nullable().default(null),
      pain_hypothesis: z.string().max(1000).nullable().default(null),
    })
    .default({ champion_name: null, economic_buyer_name: null, pain_hypothesis: null }),
  note: z.string().max(2000).nullable().default(null),
  confidence: z.enum(['high', 'medium', 'low']).catch('low').default('medium'),
})
