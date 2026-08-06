export const INDUSTRIES = [
  'Technology',
  'Healthcare',
  'Finance',
  'Education',
  'Retail',
  'Manufacturing',
  'Media',
  'Energy',
  'Real Estate',
  'Legal',
  'Consulting',
  'Non-Profit',
  'Government',
  'Other',
] as const

export const SIZE_TIERS = [
  { value: 'Micro', label: 'Micro (<$1M)' },
  { value: 'Small', label: 'Small ($1M-$10M)' },
  { value: 'Medium', label: 'Medium ($10M-$100M)' },
  { value: 'Large', label: 'Large ($100M-$1B)' },
  { value: 'Enterprise', label: 'Enterprise (>$1B)' },
] as const

export const DEFAULT_KANBAN_COLUMNS = [
  { title: 'Alvos', color: '#64748b', position: 1 },
  { title: 'Contato', color: '#6366f1', position: 2 },
  { title: 'Diagnóstico', color: '#3b82f6', position: 3 },
  { title: 'Dor validada', color: '#0ea5e9', position: 4 },
  { title: 'Solução desenhada', color: '#8b5cf6', position: 5 },
  { title: 'Prova', color: '#f59e0b', position: 6 },
  { title: 'Aprovação', color: '#ec4899', position: 7 },
  { title: 'Ganho', color: '#10b981', position: 8 },
  { title: 'Perdido', color: '#ef4444', position: 9 },
  { title: 'Gelado', color: '#94a3b8', position: 10 },
] as const

// Sinais de compromisso: o cliente fez algo que custa a ele (tempo, exposição,
// dado, aprovação). Presença = capturado. A ordem aqui é a exibida na UI.
export const COMMITMENT_SIGNALS = [
  { value: 'second_interlocutor', label: 'Trouxe um 2º interlocutor' },
  { value: 'presented_internally', label: 'Apresentou internamente (sem você na sala)' },
  { value: 'shared_real_data', label: 'Liberou dado real / print de ERP / acesso' },
  { value: 'allocated_team_member', label: 'Alocou alguém do time dele' },
  { value: 'asked_price', label: 'Perguntou preço / pediu proposta' },
  { value: 'security_process', label: 'Puxou segurança / compliance' },
] as const

// Critério de saída de cada estágio (chave = título da coluna). Mostrado como
// lembrete na aba Pipeline da empresa.
export const STAGE_EXIT_CRITERIA: Record<string, string> = {
  'Alvos': 'Conta escolhida com hipótese de dor escrita e caminho de entrada mapeado.',
  'Contato': 'O cliente respondeu e aceitou uma conversa com data marcada.',
  'Diagnóstico': 'A 1ª reunião aconteceu e você tem a dor na linguagem dele, com o processo atual e uma ordem de grandeza (horas/mês, R$, headcount).',
  'Dor validada': 'O cliente confirmou o diagnóstico por escrito; champion + quem assina + como a compra é aprovada estão mapeados.',
  'Solução desenhada': 'O cliente viu o escopo/deck adaptado e reagiu com objeções concretas ou pedidos de ajuste (silêncio educado ≠ avanço).',
  'Prova': 'Escopo de piloto acordado, com dado/acesso real liberado e um dono do lado dele.',
  'Aprovação': 'Proposta formal em análise: preço, jurídico, segurança/LGPD, compras.',
  'Ganho': 'Assinatura.',
  'Perdido': 'Motivo registrado.',
  'Gelado': 'Sem sinal do cliente há +30 dias. Registre o motivo e o gatilho de reativação.',
}

// Dias sem evento do cliente antes de sinalizar card parado / candidato a gelado.
export const STALE_DAYS = 14
export const FROZEN_DAYS = 30

export const KANBAN_COLORS = [
  '#6366f1',
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
] as const

export const COLUMN_ALIASES: Record<string, string> = {
  'first name': 'first_name',
  'fname': 'first_name',
  'first': 'first_name',
  'last name': 'last_name',
  'lname': 'last_name',
  'last': 'last_name',
  'name': 'full_name',
  'full name': 'full_name',
  'fullname': 'full_name',
  'email': 'email',
  'e-mail': 'email',
  'email address': 'email',
  'phone': 'phone',
  'phone number': 'phone',
  'telephone': 'phone',
  'tel': 'phone',
  'mobile': 'phone',
  'linkedin': 'linkedin_url',
  'linkedin url': 'linkedin_url',
  'linkedin profile': 'linkedin_url',
  'title': 'current_title',
  'job title': 'current_title',
  'position': 'current_title',
  'role': 'current_title',
  'company': 'current_company',
  'company name': 'current_company',
  'organization': 'current_company',
  'org': 'current_company',
  'category': 'category',
  'type': 'category',
  'notes': 'notes',
  'note': 'notes',
  'comments': 'notes',
}

export const IMPORTABLE_FIELDS = [
  { value: 'first_name', label: 'First Name' },
  { value: 'last_name', label: 'Last Name' },
  { value: 'full_name', label: 'Full Name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'linkedin_url', label: 'LinkedIn URL' },
  { value: 'current_title', label: 'Title' },
  { value: 'current_company', label: 'Company' },
  { value: 'category', label: 'Category' },
  { value: 'notes', label: 'Notes' },
  { value: '__skip__', label: '(Skip this column)' },
] as const

export const ACTIVITY_TYPES = [
  { value: 'meeting', label: 'Meeting', color: '#6366f1' },
  { value: 'call', label: 'Call', color: '#3b82f6' },
  { value: 'email', label: 'Email', color: '#10b981' },
  { value: 'note', label: 'Note', color: '#f59e0b' },
  { value: 'document_uploaded', label: 'Document Uploaded', color: '#8b5cf6' },
  { value: 'next_step_created', label: 'Next Step Created', color: '#ec4899' },
] as const

export const DOCUMENT_TYPES = [
  { value: 'contract', label: 'Contract' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'report', label: 'Report' },
  { value: 'other', label: 'Other' },
] as const

export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/csv',
]
