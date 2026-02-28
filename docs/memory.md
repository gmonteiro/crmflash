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

## 2026-02-28 — SQL Migration Executada

### Migration
- Executada via Supabase SQL Editor (role: postgres)
- Primeiro run falhou com `42P07: relation "companies" already exists` (tabelas existiam de tentativa anterior)
- Adicionado DROP IF EXISTS CASCADE no topo para todas as tabelas e functions
- Segundo run: **Success** — todas as 6 tabelas criadas com RLS ativo
- Tabelas confirmadas no Table Editor: companies, import_history, kanban_columns, people, people_tags, tags
- Triggers, indexes (pg_trgm) e function `create_default_kanban_columns` criados
