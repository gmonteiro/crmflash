# CRMFlash — Decision Log (Memory)

Log corrido de todas as decisoes, ajustes, bugs e mudancas de rumo.

---

## 2026-02-27 — Criacao do Projeto

### Decisoes de Arquitetura
- **Stack escolhido:** Next.js 16 + React 19 + TypeScript + Tailwind 4 + shadcn/ui + Supabase
- **Motivo:** Stack moderno, tipado, com auth/RLS built-in (Supabase), UI pronta (shadcn)
- **Supabase instance:** Reusada do TranscriptionApp (`mghvrbpadiawevdlxizr.supabase.co`)
- **Tema shadcn:** new-york (mais profissional para CRM)

### Decisoes de Schema
- `people.full_name` como GENERATED ALWAYS AS (first_name || ' ' || last_name) — evita dessincronizacao
- `kanban_position` como FLOAT para fractional indexing — evita reindex ao mover cards
- RLS em todas as tabelas com `user_id = auth.uid()` — isolamento total por usuario
- `people_tags` com policy via subquery em people.user_id — nao tem user_id proprio

### Fixes durante Build
1. Dashboard layout: `.then()` chains falhavam com Supabase untyped → trocado para async/await
2. CompanySelect: mesmo fix de `.then()` → async/await
3. Validators: `z.coerce.number()` causava mismatch com react-hook-form resolver → trocado para `z.number()`
4. AddColumnDialog: `useState(KANBAN_COLORS[0])` inferia tipo readonly → explicit `useState<string>`
5. LoginPage: `useSearchParams()` exigia `<Suspense>` boundary
6. useKanban: resultado do Supabase precisava de `as KanbanColumn[]` cast

---

## 2026-02-28 — Kanban Manual + AI Enrichment

### Kanban: Remocao de Auto-Assign
- **Motivo:** Usuario quer controle total sobre quem aparece no board
- **Mudanca:** Removido auto-assign em `createPerson` (use-people.ts) e `executeImport` (use-import.ts)
- **Impacto:** Pessoas novas ficam com `kanban_column_id = null` — nao aparecem no board
- **Novo fluxo:** Usuario usa dialog "Add Person" no board para adicionar manualmente

### Kanban: Add Person Dialog
- **Implementacao:** Dialog com busca debounced (300ms), filtra `kanban_column_id IS NULL`, select de coluna destino, click para adicionar
- **Decisao:** Default para primeira coluna se nenhuma selecionada
- **Funcoes novas no useKanban:** `addPersonToBoard`, `removePersonFromBoard`

### Enrichment: Proxycurl → Claude API
- **Motivo:** Proxycurl descontinuado/caro. Claude API com web_search e mais versatil
- **Stack:** @anthropic-ai/sdk + Claude Haiku 4.5 + web_search_20250305 (server tool)
- **Decisao de modelo:** Haiku 4.5 para custo baixo (enrich e task simples de extracao)
- **Decisao de API:** Rota unificada `/api/enrich` para person e company (antes era so person via `/api/linkedin/enrich`)
- **Campos:** So sobrescreve campos vazios (respeita dados ja preenchidos pelo usuario)
- **Company auto-create:** Se enrichment encontra empresa e person nao tem company_id, cria ou associa

### Cleanup
- Deletados 5 arquivos do Proxycurl + diretorios vazios
- Settings atualizado: icone Sparkles, textos Anthropic/Claude, env var ANTHROPIC_API_KEY
- .env.local: PROXYCURL_API_KEY → ANTHROPIC_API_KEY

### Build
- `npm run build` passa com zero erros apos todas as mudancas
- Rota antiga `/api/linkedin/enrich` removida do build output
- Nova rota `/api/enrich` aparece corretamente

---

## 2026-02-28 — Bulk Enrich + Bug Fixes + Streaming

### Bulk Enrich Companies
- **Feature:** Botao "Enrich All" na pagina /companies enriquece todas as empresas nao-enriquecidas sequencialmente
- **Hook:** `useBulkEnrich` em use-enrich.ts — loop sequencial com cancel via ref, tracking de running/current/total/succeeded/failed
- **UI:** Dialog com Progress bar, nome da empresa atual, contadores de sucesso/falha, botao Cancel/Done
- **Heuristica:** Empresa e "unenriched" se TODOS os campos industry, description, employee_count, estimated_revenue, size_tier sao null

### Bug Fix: Invalid URL crash na CompanyTable
- `new URL(website)` crashava quando AI retornava website sem protocolo (ex: "example.com")
- Fix: try-catch com fallback para string raw

### Bug Fix: getTextFromResponse so pegava primeiro text block
- Com web_search, response do Anthropic tem multiplos content blocks (tool_use, tool_result, text)
- O JSON ficava no ULTIMO text block, mas funcao retornava so o primeiro
- Fix: concatenar TODOS os text blocks

### Bug Fix: Disambiguacao de empresas com nomes genericos
- Empresas como "Flash" e "Linx" retornavam dados da empresa errada
- Fix: Passar dados dos people vinculados (nome, titulo, email, linkedin, current_company) no prompt
- Prompt enfatiza usar nacionalidade, dominio de email, e LinkedIn para identificar empresa correta

### Bug Fix: Tags <cite> no description
- AI retornava `<cite index="...">texto</cite>` nos campos de texto
- Fix: `stripCiteTags()` remove tags antes de extrair JSON

### Bug Fix: parseStreamResponse regex nao parseava JSON aninhado
- Regex `\{[^{}]*\}$` nao matchava `{"success":true,"enriched":{"industry":"..."}}` (chaves aninhadas)
- Fix: usar `indexOf("{")` + `JSON.parse()` direto

### Streaming Response para bypass de timeout do Vercel
- **Problema:** Vercel free tier tem timeout de 10s; enrichment com web_search leva 10-20s
- **Solucao:** API retorna TransformStream. Cada token do Anthropic envia byte keepalive (espaco). JSON final enviado no fim
- **Impacto:** `claude-enrich.ts` usa `client.messages.stream()` com callback `onProgress`; `route.ts` usa TransformStream; `use-enrich.ts` parseia response com trim + indexOf

### Custo Alto — Pendente
- ~$0.06/enrichment com web_search e inaceitavel para uso em escala
- Proximo passo: batching, limitar web search uses, e/ou modelo mais barato

---

## 2026-02-28 — SQL Migration Executada

### Migration
- Executada via Supabase SQL Editor (role: postgres)
- Primeiro run falhou com `42P07: relation "companies" already exists` (tabelas existiam de tentativa anterior)
- Adicionado DROP IF EXISTS CASCADE no topo para todas as tabelas e functions
- Segundo run: **Success** — todas as 6 tabelas criadas com RLS ativo
- Tabelas confirmadas no Table Editor: companies, import_history, kanban_columns, people, people_tags, tags
- Triggers, indexes (pg_trgm) e function `create_default_kanban_columns` criados

---

## 2026-02-28 — Multi-Provider Enrichment + Reasoning Window

### Provider Abstraction
- **Motivo:** Custo de $0.06/enrichment com Anthropic+web_search inaceitavel
- **Solucao:** Arquitetura multi-provider com factory pattern
- **Novo default:** OpenAI GPT-4o-mini (~$0.0002/company, 300x mais barato)
- **Fallback:** Anthropic Haiku + web_search mantido para quem precisa de dados atualizados
- **Env var:** `ENRICH_PROVIDER=openai|anthropic` (default: openai)

### Estrutura de Arquivos
- Deletado `claude-enrich.ts` (monolitico)
- Novo: `types.ts`, `parse.ts`, `prompts.ts` (extraidos)
- Novo: `providers/openai.ts`, `providers/anthropic.ts` (implementacoes)
- Novo: `index.ts` (factory `getEnrichProvider()`)

### Batch Enrichment
- Nova rota `/api/enrich/batch` aceita ate 5 companyIds por request
- OpenAI provider envia 1 API call para 5 empresas (batch prompt)
- Anthropic provider processa sequencialmente (web_search nao funciona bem em batch)
- `useBulkEnrich` agora envia batches de 5 ao inves de 1 por 1

### SSE Streaming
- API migrada de keepalive-spaces para SSE format (`data: {...}\n\n`)
- Eventos tipados: reasoning, result, batch_item, done, error
- Client hook `parseSSEStream()` processa eventos incrementalmente

### Reasoning Window
- Novo componente `ReasoningPanel` com icone Brain, collapsible, auto-scroll
- Mostra texto do AI em tempo real durante enrichment
- Integrado em `EnrichButton` (single) e dialog de "Enrich All" (bulk)

### Settings
- Titulo atualizado para "AI Enrichment Provider"
- Instrucoes para ambos OpenAI e Anthropic API keys
- Documentacao do env var ENRICH_PROVIDER

### Build
- `npm run build` passa com zero erros
- Dependencia `openai` adicionada ao package.json

---

## 2026-02-28 — Perplexity + Exa Providers & Overwrite on Re-enrich

### Novos Providers
- **Perplexity Sonar** (~$0.006/co): Reusa SDK `openai` com `baseURL: "https://api.perplexity.ai"`, modelo `sonar`, web search built-in
- **Exa Answer** (~$0.005/co): SDK `exa-js`, usa `exa.answer()`, sem streaming (resposta inteira)
- Ambos processam batch sequencialmente (web search por company)
- Env vars: `PERPLEXITY_API_KEY`, `EXA_API_KEY`

### Overwrite on Re-enrich
- Removidas guards `&& !field` em `route.ts` e `batch/route.ts`
- Agora re-enrich sobrescreve todos os campos com dados novos do AI
- Fix bug: `if (enriched.notes && !person.current_title)` → `if (enriched.notes)`

### Arquivos
- Novo: `providers/perplexity.ts`, `providers/exa.ts`
- Modificado: `index.ts` (factory), `route.ts`, `batch/route.ts`, `settings/page.tsx`
- Dependencia: `exa-js` adicionada

### Build
- `npm run build` passa com zero erros

---

## 2026-02-28 — Kanban: Companies Instead of People + Card Delete

### Kanban Refactor: People → Companies
- **Motivo:** Board agora gerencia Companies em vez de People
- **Migration:** `002_companies_kanban.sql` — `kanban_column_id` + `kanban_position` na tabela `companies`
- **Types:** `Company` interface ganhou `kanban_column_id` / `kanban_position`; `kanban.ts` trocou `Person[]` → `Company[]`
- **Hook:** `useKanban` queries agora em `companies`; `addCompanyToBoard` / `removeCardFromBoard` substituem antigos
- **Card:** Mostra `company.name`, badges de `industry` + `size_tier`, link para `/companies/{id}`
- **Delete button:** Botao X visivel no hover, remove card do board (set `kanban_column_id = null`)
- **Compact cards:** `p-2` padding, badges `h-4 px-1`, grip icon menor
- **Dialog:** `AddCompanyDialog` substitui `AddPersonDialog` — busca por `name`, icone `Building2`
- **Cleanup:** Deletado `add-person-dialog.tsx`

### Build
- `npm run build` passa com zero erros

---

## 2026-02-28 — Scale Import to Handle 4000+ Rows

### Pre-deduplicate Companies
- **Problema:** Cada row fazia SELECT + possivel INSERT para company = ~8000 queries para 4000 rows
- **Solucao:** Coletar nomes unicos, 1 query com `.in()` (chunks de 100), 1 batch INSERT para missing
- **Resultado:** ~2 queries no total (1 SELECT + 1 INSERT)

### Batch Size 50 → 500
- Supabase suporta ate 1000 rows por insert
- 4000 rows agora faz 8 batches ao inves de 80

### Build
- `npm run build` passa com zero erros (scale import)

---

## 2026-02-28 — Validation Performance + Import Deduplication

### Validation: Removido Chunked setTimeout
- **Problema:** `setTimeout(_, 0)` + React re-render por chunk era mais lento que a validacao em si
- **Solucao:** Validacao sincrona com `.map()` — `validateRow` e pure string ops, <200ms para 100k rows
- **Resultado:** Removido step `"validating"` e progress bar. Mapping → Preview instantaneo
- **Cleanup:** Removido `validatingProgress` state, `Progress` import, step indicator mapping

### Import Deduplication (2 camadas)
- **Intra-file (preview):** Detecta duplicatas DENTRO do mesmo arquivo
  - Chave primaria: `first_name + last_name + current_title + current_company` (case-insensitive)
  - Marca como erro na validacao, aparece no preview
- **Database (execution):** Detecta duplicatas contra pessoas JA existentes no banco
  - Mesma chave: `first_name + last_name + current_title + current_company`
  - Fetch ALL existing people com `.limit(50000)` (fix: Supabase default e 1000)
  - Rows duplicadas sao silenciosamente skipadas, contadas como "X duplicates skipped"
- **Companies:** Fetch ALL companies do usuario em 1 query, match case-insensitive por nome
  - Fix: `.limit(50000)` para nao truncar em 1000

### UI: Import Results
- Novo campo `skipped` no results object
- `ImportProgress` mostra "X duplicates skipped" com icone amarelo

### Bug Fix: XLSX Numeric Cells Crashing Validation
- **Problema:** `sheet_to_json` com `defval: ""` so seta default para celulas vazias — numeros, datas e booleans vinham como tipos nativos (number, Date, boolean)
- **Sintoma:** `.trim()` em numero (ex: phone `5511999`) crashava com TypeError, catch silencioso resetava step para "mapping"
- **Fix 1:** `parse-xlsx.ts` agora faz `String(val)` em todos os valores antes de retornar
- **Fix 2:** `validate-row.ts` usa `String(row[sourceCol] ?? "")` como defesa extra

### Validation Loading State
- **Problema:** Validacao sincrona sem feedback visual — usuario clicava "Continue" e nada acontecia
- **Solucao:** `confirmMapping` seta `step = "validating"` imediatamente, processa com `setTimeout(_, 50)` para dar tempo ao React renderizar spinner
- **UI:** Spinner com texto "Validating and checking for duplicates..."
- **Error handling:** try-catch loga erro e volta para "mapping" se falhar

### Git config
- Email do repo atualizado de `gabriel.monteiro@vtex.com` para `gq.monteiro@gmail.com`

---

## 2026-03-01 — Company Detail: Documents, Timeline, Next Steps & Calendar

### Migration 003: company_details.sql
- 3 novas tabelas: `company_documents`, `company_activities`, `company_next_steps`
- Bucket Supabase Storage `company-documents` (privado, RLS via folder structure `{user_id}/{company_id}/{uuid}_{filename}`)
- RLS em todas as 3 tabelas + storage policies com `foldername(name)[1] = auth.uid()`
- Indexes compostos: `(user_id, status, due_date)` em next_steps para calendar queries
- Triggers `handle_updated_at` em documents e next_steps

### Company Detail Page: Tabs
- **Antes:** Card unico com header + body (descricao, links, people)
- **Depois:** Header extraido + Tabs (Overview | Timeline | Documents | Next Steps)
- Componentes extraidos: `company-detail-header.tsx`, `company-overview-tab.tsx`
- Novos: `company-timeline-tab.tsx`, `company-documents-tab.tsx`, `company-next-steps-tab.tsx`
- Tabs usam variant="line" do shadcn (underline style)

### Documents Tab
- Upload via Supabase Storage (`company-documents` bucket)
- File path: `{user_id}/{company_id}/{uuid}_{filename}`
- Download via signed URL (1hr TTL)
- Tipos: PDF, DOCX, images, text, Excel — max 10MB
- `doc_type`: contract, proposal, invoice, report, other
- Upload auto-cria activity no timeline (`document_uploaded`)

### Timeline Tab
- Quick note input (textarea + Ctrl+Enter para salvar)
- "Add Activity" dialog: type (meeting/call/email/note), title, description, datetime
- Vertical timeline com dots coloridos por tipo e icones
- Auto-entries (document_uploaded, next_step_created) com styling muted
- Sorted newest first

### Next Steps Tab
- Lista com checkboxes (toggle pending/completed)
- Due date com badge "Overdue" se passada
- Completed items no fundo com strikethrough e opacity
- Criar step auto-cria activity no timeline (`next_step_created`)

### Calendar Page (`/calendar`)
- Nova rota + nav item no sidebar (CalendarDays icon, entre Kanban e Import)
- Grid mensal (7 cols × 5-6 rows) com dots coloridos por status
- Click em dia abre painel com next steps de TODAS as empresas
- Cada item: titulo, link para empresa, checkbox, badge overdue
- Navegacao < prev | Month Year | next >
- Hook `useCalendar`: fetch `company_next_steps` joined com `companies(id, name)`, filtrado por range do mes

### Novos Hooks
- `use-company-documents.ts` — CRUD + Storage upload/download/delete + auto-activity
- `use-company-activities.ts` — CRUD, sorted by date DESC
- `use-company-next-steps.ts` — CRUD + toggleComplete + auto-activity
- `use-calendar.ts` — fetch month range across all companies, joined with company name

### Dependencia
- `date-fns` adicionada para calendar arithmetic (startOfMonth, endOfMonth, format, isBefore, etc.)

### Build
- `npm run build` passa com zero erros
- `tsc --noEmit` sem erros
- Rota `/calendar` aparece no build output

---

## 2026-08-19 — Copiloto Comercial (Fase 1)

O CRM era passivo: so registrava o que era digitado nele. O kanban tinha estagios
com criterio de saida, sinais de compromisso e `last_client_event_at`, mas tudo
so atualizava se o usuario lembrasse de clicar. Na pratica o board envelhecia e
`/pipeline` mostrava metricas de um estado desatualizado.

A Fase 1 inverte a direcao: o app pergunta, o usuario responde em segundos, o CRM
se atualiza.

### Extracao de `src/lib/pipeline/`
- **Motivo:** ~80% da deteccao que o copiloto precisa ja existia dentro de
  `use-pipeline-metrics.ts` (cards parados, gelados, gargalo, funil). Duplicar
  isso no copiloto faria as duas telas divergirem em semanas.
- **Solucao:** modulos puros — `types.ts` (PipelineSnapshot), `stages.ts`
  (TERMINAL_STAGES, OUTCOME_STAGES, nextStage/prevStage, daysInCurrentStage),
  `snapshot.ts` (fetchPipelineSnapshot), `metrics.ts` (computePipelineMetrics),
  `move.ts` (applyStageMove + inferDirection).
- `use-pipeline-metrics.ts` caiu de 249 para 27 linhas; `use-kanban.moveCard`
  delega as escritas para `applyStageMove`.
- **Fix de passagem 1:** a query de `company_stage_events` nao tinha `.limit()`.
  O Supabase corta em 1000 linhas silenciosamente — as metricas passariam a
  mentir sem aviso quando o log crescesse. Todas as queries do snapshot agora
  tem `.limit(5000)`.
- **Fix de passagem 2:** o update de `companies` em `moveCard` estava sem
  `.eq("user_id", user.id)`, ao contrario de todas as outras escritas do repo.

### Perguntas sao COMPUTADAS, nao persistidas
- **Motivo:** uma pergunta depende de estado mutavel ("14 dias sem evento",
  "proximo passo vencido"). Linha persistida ficaria obsoleta no instante em que
  o card se move, e gera-la exigiria um scheduler que nao existe no projeto.
- **Solucao:** `detectQuestions(snapshot, suppressedKeys)` roda no cliente a cada
  load. O que persiste e a RESPOSTA, em `copilot_question_events` (migration 009).
- **Impacto:** supressao, snooze, dismiss e dedup do mesmo dia colapsam num
  mecanismo unico — a pergunta some enquanto existir linha com
  `suppress_until >= hoje`. Dismiss = hoje + 365.

### Invariante central
`last_client_event_at` so sobe quando o CLIENTE fez algo. Acao do vendedor
(cobrar, concluir tarefa, mandar proposta, reuniao que nao aconteceu) nunca
bumpa. Isso vale para as quick actions, para os efeitos e e a regra numero 1 do
prompt de interpretacao.

### 9 regras (`src/lib/pipeline/rules.ts`)
`meeting_yesterday` (100), `next_step_overdue` (95), `no_next_step` (90),
`frozen_candidate` (85), `stalled_card` (80), `no_signal_past_stage` (70),
`exit_criteria_unmet` (60), `missing_champion` (50), `missing_pain_hypothesis` (40).
Ordenadas por prioridade → severidade, no maximo 2 por empresa e 10 no total —
sem esse teto uma conta bagunçada monopoliza a fila inteira.

### Texto livre → proposta
- **Motivo:** botao resolve o caso comum, mas perde a nuance do que o cliente
  realmente disse.
- **Solucao:** `/api/copilot/interpret` monta o contexto da conta NO SERVIDOR
  (nunca aceito do cliente, senao daria para forjar o estagio), chama Claude
  Haiku com `temperature: 0` e sem tools, valida com zod.
- **Nunca auto-aplica.** `company_stage_events` e append-only (sem policy de
  UPDATE): um estagio alucinado deixaria evento errado permanente nas metricas.
  O usuario confirma item a item em `copilot-proposal-review.tsx`.
- Clamps de sanidade no servidor: descarta `stage_target_title` fora das colunas
  reais, descarta sinais ja capturados, e forca `stage_move: "none"` quando
  `confidence === "low"`.
- `COPILOT_PROVIDER` default `anthropic` — nao `openai` como no enrich, porque
  `ANTHROPIC_API_KEY` e a unica chave garantida no ambiente.

### UI
- **Primeira versao (substituida no mesmo dia):** drawer lateral dentro do
  kanban, com badge no `kanban-card` e auto-abertura 1x/dia via localStorage.
  Ver a entrada seguinte — o copiloto foi movido para a pagina principal.
- Estado derivado em vez de sincronizado: o indice da fila e clampeado no render
  e a proposta fica amarrada a `questionKey`, entao trocar de pergunta a invalida
  sozinho. Isso eliminou 4 `useEffect` de limpeza.

### Build
- `npm run build` passa com zero erros; rota `/api/copilot/interpret` no output.
- `tsc --noEmit` sem erros.
- Lint: os arquivos novos estao limpos, exceto o efeito de auto-abertura, que e
  legitimamente um efeito. Os demais avisos sao o idioma `useEffect(() => fetch(),
  [fetch])` que ja existia em todos os hooks do projeto.

### Pendente
- Migration `009_copilot.sql` rodada no Supabase em 2026-08-19.
- Fase 2 (rascunhos de WhatsApp) e Fase 3 (Gmail + Calendar) ainda nao iniciadas.
  A quick action "Redigir retomada" ja existe em `stalled_card` mas mostra um
  toast de "chega na proxima fase".

---

## 2026-08-19 — Copiloto movido para a pagina principal

- **Motivo:** o kanban tinha sido escolhido como "playground" do novo modelo de
  experiencia, mas o copiloto e um **ritual diario**, e ritual pertence a tela em
  que voce cai ao abrir o app. Dentro do kanban ele dependia de um drawer que
  precisava se auto-abrir para ser lembrado — sintoma de estar no lugar errado.
- **Solucao:** `copilot-panel.tsx`, um Card inline no topo de `/dashboard`.
  `copilot-drawer.tsx` e `copilot-trigger-button.tsx` foram DELETADOS.
  `kanban-board.tsx`, `kanban-column.tsx` e `kanban-card.tsx` voltaram ao estado
  original — o board nao tem mais nada de copiloto.
- **Ganho de layout:** a home e larga, entao o painel mostra a pergunta atual
  (2/3) ao lado da fila inteira clicavel (1/3). No drawer estreito so cabia uma
  pergunta por vez, sem nocao de quanto faltava.
- **Sumiu a auto-abertura:** sendo a pagina inicial, a fila ja esta na frente do
  usuario. `localStorage.copilotLastOpened` nao existe mais.
- **Fix de passagem:** o "Pipeline Overview" do dashboard contava **pessoas** por
  coluna do kanban — defasado desde que o board virou de empresas, e contradizia
  o proprio kanban logo ao lado. Agora conta empresas. De quebra, era um count
  por coluna (N+1, 10 round-trips); virou uma query so, agregada em JS.

### Build
- `npm run build` passa com zero erros; `tsc --noEmit` sem erros.
- Os arquivos do copiloto ficaram limpos no lint. O unico aviso na home e o
  idioma `useEffect(() => fetch(), [fetch])`, ja presente nos 13 hooks do projeto.
