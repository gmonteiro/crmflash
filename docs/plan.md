# CRMFlash — Plano de Execucao

## Fase 1: Scaffold + Auth + Database
**Dependencias:** Nenhuma
**Entregavel:** Projeto rodando com login funcional

1. Criar projeto Next.js 16 com TypeScript + Tailwind CSS 4
2. Instalar e configurar shadcn/ui (tema new-york)
3. Configurar Supabase client (browser) e server (cookie-based SSR)
4. Criar middleware de autenticacao
5. Criar paginas /login e /signup
6. Criar callback OAuth (/auth/callback) com criacao de colunas default
7. Criar layout dashboard com sidebar + header
8. Escrever SQL migration completa (todas as tabelas, RLS, triggers, indexes)
9. Criar types TypeScript para todas as tabelas
10. Criar validators Zod para formularios

**Status:** CONCLUIDO

---

## Fase 2: CRUD People + Companies
**Dependencias:** Fase 1
**Entregavel:** Tabelas, formularios, detail pages funcionais

1. Hook `usePeople` — fetch paginado, busca, filtro, CRUD
2. Hook `useCompanies` — mesmo padrao
3. Tabela People com @tanstack/react-table
4. Dialog "Add Person" com react-hook-form
5. Person detail page (/people/[id]) com edicao inline
6. Tabela Companies
7. Dialog "Add Company"
8. Company detail page (/companies/[id]) com lista de people
9. CompanySelect component para associar pessoa a empresa

**Status:** CONCLUIDO

---

## Fase 3: Import CSV/XLSX
**Dependencias:** Fase 2
**Entregavel:** Wizard de importacao funcional

1. Instalar papaparse + xlsx
2. Criar parsers (parse-csv.ts, parse-xlsx.ts)
3. Criar auto-mapper de colunas (map-columns.ts com aliases)
4. Criar validador de linhas (validate-row.ts)
5. Hook `useImport` com state machine de 4 passos
6. UI do wizard: Upload → Mapping → Preview → Execution
7. Batch insert com progresso e historico

**Status:** CONCLUIDO

---

## Fase 4: Kanban Board
**Dependencias:** Fase 2
**Entregavel:** Board drag-and-drop funcional

1. Instalar @dnd-kit/core + @dnd-kit/sortable
2. Criar fractional indexing utilities
3. Hook `useKanban` — fetch board, moveCard, reorderColumns, CRUD columns
4. KanbanProviders (DndContext + SortableContext)
5. KanbanColumn component (sortable, droppable)
6. KanbanCard component (draggable)
7. AddColumnDialog
8. DragOverlay para feedback visual

**Status:** CONCLUIDO

---

## Fase 4.1: Kanban — Adicao Manual
**Dependencias:** Fase 4
**Entregavel:** Pessoas adicionadas manualmente ao board

1. Remover auto-assign em `usePeople.createPerson`
2. Remover auto-assign em `useImport.executeImport`
3. Adicionar `addPersonToBoard` e `removePersonFromBoard` ao `useKanban`
4. Criar AddPersonDialog (busca + select coluna)
5. Conectar no KanbanBoard

**Status:** CONCLUIDO

---

## Fase 5: AI Enrichment (Claude API)
**Dependencias:** Fase 2
**Entregavel:** Enriquecimento por AI funcional

1. Instalar @anthropic-ai/sdk
2. Criar modulo claude-enrich.ts (enrichPerson, enrichCompany com web_search)
3. Criar API route /api/enrich (POST, unificada person/company)
4. Criar hook useEnrich (client-side)
5. Criar EnrichButton generico (Sparkles icon)
6. Integrar em PersonDetailCard (substituir LinkedIn button)
7. Integrar em CompanyDetailCard
8. Atualizar Settings page (Proxycurl → Anthropic)
9. Deletar arquivos Proxycurl antigos
10. Atualizar .env.local

**Status:** CONCLUIDO

---

## Fase 6: Polish
**Dependencias:** Fases 1-5
**Entregavel:** App polido e responsivo

1. Dashboard com stats cards e pipeline overview
2. Dark mode via next-themes
3. Responsividade (sidebar, tabelas, kanban)
4. Skeletons em todas as paginas
5. Toasts para feedback de acoes

**Status:** CONCLUIDO

---

## Fase 7: Deploy + Testes (PENDENTE)
**Dependencias:** Fases 1-6
**Entregavel:** App funcionando em producao

1. Rodar SQL migration no Supabase
2. Testar fluxo completo de auth
3. Testar CRUD people + companies
4. Testar import CSV/XLSX
5. Testar kanban (add person, drag, reorder)
6. Testar enrichment (person + company)
7. Configurar ANTHROPIC_API_KEY
8. (Opcional) Deploy no Vercel

**Status:** PENDENTE
