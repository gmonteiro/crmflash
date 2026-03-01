# CRMFlash — Specification

## Visao Geral
CRM pessoal para gerenciar contatos profissionais (People), empresas (Companies) e pipeline de relacionamento (Kanban). Suporta importacao em massa via CSV/XLSX e enriquecimento automatico de dados via AI.

**Stack:** Next.js 16 + React 19 + TypeScript 5 + Tailwind CSS 4 + shadcn/ui + Supabase

---

## Modulo 1: Auth

### 1.1 Signup
- Formulario com email + password
- Cria usuario no Supabase Auth
- Apos confirmacao, redireciona para `/dashboard`

### 1.2 Login
- Email + password
- Google OAuth via Supabase
- Redirect de `/auth/callback` cria colunas kanban default na primeira vez

### 1.3 Middleware
- Rotas publicas: `/login`, `/signup`, `/auth/callback`
- Todas as outras rotas exigem sessao autenticada
- Redireciona para `/login` se nao autenticado

### 1.4 Logout
- Sidebar com botao de logout
- Chama `supabase.auth.signOut()` e redireciona para `/login`

---

## Modulo 2: People (CRUD)

### 2.1 Listagem
- Tabela paginada (25/pagina) com `@tanstack/react-table`
- Busca por nome (ilike full_name)
- Filtro por categoria
- Ordenacao por qualquer coluna
- Colunas: Nome, Email, Titulo, Empresa, Categoria, Criado em

### 2.2 Criacao
- Dialog com formulario (react-hook-form + zod)
- Campos: first_name*, last_name*, email, phone, linkedin_url, current_title, current_company, company_id (select), category, notes
- `full_name` gerado automaticamente pelo banco (GENERATED ALWAYS AS)
- Pessoa nova NAO e atribuida ao kanban (kanban_column_id = null)

### 2.3 Edicao Inline
- Botao Edit no detail card alterna para modo edicao
- Salva via PATCH otimista

### 2.4 Detail Page (`/people/[id]`)
- Card com avatar (iniciais), nome, titulo, empresa (link), email, phone, linkedin, categoria, notas
- Botao "Enrich" (AI) no header
- Data de ultimo enriquecimento exibida

### 2.5 Exclusao
- Delete via botao na tabela
- Otimista (remove da lista, reverte se erro)

---

## Modulo 3: Companies (CRUD)

### 3.1 Listagem
- Tabela paginada com busca por nome e filtro por industria
- Colunas: Nome, Industria, Size Tier, Employees, Website

### 3.2 Criacao
- Dialog com formulario
- Campos: name*, domain, linkedin_url, industry (select), size_tier (select), estimated_revenue, employee_count, description, website

### 3.3 Detail Page (`/companies/[id]`)
- Card com icone, nome, badges (industry, size_tier), descricao, website, linkedin, employee count, revenue
- Lista de People associadas (link para cada)
- Botao "Enrich" (AI) no header

### 3.4 Exclusao
- Delete otimista
- People associadas tem `company_id` setado para null (ON DELETE SET NULL)

---

## Modulo 4: Import CSV/XLSX

### 4.1 Wizard de 4 passos
1. **Upload** — Arrastar ou selecionar arquivo (.csv, .xlsx, .xls)
2. **Mapping** — Mapear colunas do arquivo para campos do sistema
   - Auto-detect via aliases fuzzy (ex: "First Name" → first_name)
   - Dropdown para ajuste manual
   - Opcao "(Skip this column)"
3. **Preview** — Tabela com validacao por linha (verde/vermelho)
   - Mostra erros (ex: email invalido, nome faltando, duplicata no arquivo)
   - Dedup intra-file: detecta linhas duplicadas por nome + titulo + empresa (case-insensitive)
4. **Execution** — Barra de progresso, batch insert (500 por vez)
   - Dedup database: skipa pessoas que ja existem (chave: first_name + last_name + current_title + current_company)
   - Auto-cria companies se `current_company` preenchido (dedup case-insensitive por nome)
   - Mostra contagem de duplicatas skipadas nos resultados
   - Grava import_history com resultados

### 4.2 Parsing
- CSV: papaparse (auto-detect delimitador, header)
- XLSX: SheetJS (primeira aba, header na primeira linha)

### 4.3 Importados NAO vao pro Kanban
- `kanban_column_id = null`, `kanban_position = null`
- Deve ser adicionado manualmente via dialog no board

---

## Modulo 5: Kanban Board

### 5.1 Colunas
- Default: New Contact, Reached Out, In Conversation, Opportunity, Closed
- Criadas automaticamente no primeiro login (via `create_default_kanban_columns`)
- CRUD de colunas: adicionar (titulo + cor), renomear, deletar
- Deletar coluna: move cards para outra coluna ou seta null
- Drag-and-drop para reordenar colunas

### 5.2 Cards (People)
- Card exibe: nome, titulo, nome da empresa
- Drag-and-drop entre colunas e dentro da coluna
- Posicao calculada com fractional indexing

### 5.3 Adicao Manual
- Dialog "Add Person" no header do board
- Busca pessoas com `kanban_column_id IS NULL`
- Select para escolher coluna destino (default: primeira)
- Click na pessoa → adiciona ao board com update otimista

### 5.4 Remocao do Board
- `removePersonFromBoard(personId)` seta kanban_column_id = null
- (Funcao disponivel mas ainda sem UI dedicada)

### 5.5 Drag-and-Drop
- `@dnd-kit/core` + `@dnd-kit/sortable`
- Sensors: pointer + keyboard
- DragOverlay para feedback visual
- Dois tipos de drag: card e column

---

## Modulo 6: AI Enrichment

### 6.1 Enriquecimento de Pessoa
- Botao "Enrich" (icone Sparkles) no detail card
- Chama `POST /api/enrich` com `{ type: "person", personId }`
- Backend usa Claude Haiku 4.5 + web_search para buscar:
  - current_title, current_company, linkedin_url, notas
- So sobrescreve campos vazios
- Auto-cria/associa company se encontrada e person nao tem company_id

### 6.2 Enriquecimento de Empresa
- Botao "Enrich" no detail card da empresa
- Chama `POST /api/enrich` com `{ type: "company", companyId }`
- Backend busca people vinculados (nome, titulo, email, linkedin, current_company) para disambiguacao
- Busca: industry, description, website, domain, linkedin_url, employee_count, estimated_revenue, size_tier
- So sobrescreve campos vazios

### 6.3 Bulk Enrich
- Botao "Enrich All" (icone Sparkles) na pagina /companies
- Busca TODAS as empresas (nao paginado), filtra unenriched (todos os 5 campos-chave null)
- Dialog com progress bar, nome atual, contadores sucesso/falha, cancel
- Processa sequencialmente via `useBulkEnrich` hook
- Apos completar, refaz fetch da tabela

### 6.4 Streaming / Timeout
- API route retorna streaming response (TransformStream)
- Anthropic SDK usa `client.messages.stream()` com onProgress callback
- Cada token gera byte keepalive (espaco) para manter conexao viva no Vercel
- Client parseia response: trim + indexOf para extrair JSON final
- `maxDuration = 60` como fallback para Vercel Pro

### 6.5 Configuracao
- `ANTHROPIC_API_KEY` em `.env.local`
- Settings page mostra campo para referencia (nao armazena server-side)

---

## Modulo 7: Dashboard

### 7.1 Stats Cards
- Total de People
- Total de Companies
- Total de Imports realizados

### 7.2 Pipeline Overview
- Resumo das colunas kanban com contagem de cards

---

## Modulo 8: Settings

### 8.1 Aparencia
- Seletor de tema: Light / Dark / System
- Persiste via next-themes (localStorage)

### 8.2 AI Enrichment
- Campo para Anthropic API Key (informativo)
- Instrucoes para configurar `ANTHROPIC_API_KEY` no `.env.local`

---

## Modulo 9: Polish / UX

### 9.1 Dark Mode
- Suporte completo via Tailwind + next-themes

### 9.2 Responsividade
- Layout com sidebar colapsavel em mobile
- Tabelas com scroll horizontal
- Kanban com scroll horizontal

### 9.3 Skeletons
- Loading skeletons em todas as paginas que buscam dados

### 9.4 Toasts
- Feedback visual para todas as acoes (sucesso/erro) via sonner

---

## Database Schema

### Tabelas
| Tabela | Campos principais |
|--------|-------------------|
| `companies` | id, user_id, name, domain, linkedin_url, industry, size_tier, estimated_revenue, employee_count, description, logo_url, website, metadata |
| `people` | id, user_id, first_name, last_name, full_name (generated), email, phone, linkedin_url, current_title, current_company, company_id (FK), category, notes, avatar_url, linkedin_enriched_at, kanban_column_id (FK), kanban_position |
| `kanban_columns` | id, user_id, title, color, position |
| `tags` | id, user_id, name, color |
| `people_tags` | person_id, tag_id (composite PK) |
| `import_history` | id, user_id, filename, file_type, row_count, success_count, error_count, column_mapping, errors, status, completed_at |

### RLS
- Todas as tabelas com RLS habilitado
- Policy: `user_id = auth.uid()` para SELECT, INSERT, UPDATE, DELETE
- `people_tags`: policy via subquery em `people.user_id`

### Triggers / Functions
- `handle_updated_at()` — atualiza `updated_at` automaticamente
- `create_default_kanban_columns(p_user_id)` — cria 5 colunas padrao
