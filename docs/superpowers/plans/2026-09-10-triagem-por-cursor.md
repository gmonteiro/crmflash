# Triagem por cursor — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma fila de triagem no topo da aba Shortlists do `/people`, que mostra só os contatos do usuário logado ainda não triados e encolhe a cada marcação.

**Architecture:** Um cursor por usuário em `screening_cursors` guarda a chave de ordenação (`created_at`, `id`) do último contato triado. Um hook lê os contatos do dono na ordem congelada `created_at desc, id asc` a partir do cursor; marcar adiciona à shortlist mais antiga e avança o cursor. A tabela é o `PeopleTable` existente com ordenação desligada.

**Tech Stack:** Next.js 16, React 19, Supabase (PostgREST + RLS), @tanstack/react-table, vitest.

Spec: `docs/superpowers/specs/2026-09-10-triagem-por-cursor-design.md`

## Global Constraints

- Ordem da fila congelada em `created_at desc, id asc`. Nunca ordenável pela tela.
- Fila mostra só contatos com vínculo em `people_owners` para o usuário logado.
- Só marcações feitas de dentro da fila avançam o cursor.
- Marcação entra na shortlist mais antiga do workspace (`shortlists[shortlists.length - 1]` de `useShortlists`, como o `/people` já faz).
- Migração roda à mão no SQL Editor do Supabase, inteira e de uma vez. Não há CLI configurado.
- Textos da tela em português, no mesmo tom das telas recentes ("Dono").
- Testes só de lógica pura (`src/**/*.test.ts`, ambiente node). Sem testes de componente.
- Commits em português, no formato `feat(...)`, `docs(...)`, `test(...)` do histórico.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/screening.ts` (novo) | Lógica pura: `farthest` e `afterCutFilter`. |
| `src/lib/screening.test.ts` (novo) | Testes dos dois. |
| `supabase/migrations/017_screening_cursors.sql` (novo) | Tabela, RLS, seed dos dois cursores. |
| `src/types/database.ts` | Tipo `ScreeningCursor`. |
| `src/components/people/people-table-columns.tsx` | Prop `sortable` que desliga os cabeçalhos clicáveis. |
| `src/components/people/people-table.tsx` | Repassa `sortable`. |
| `src/hooks/use-screening-queue.ts` (novo) | Cursor, fila paginada, `mark`. |
| `src/components/people/screening-queue.tsx` (novo) | Linha de contexto + tabela + estados vazios. |
| `src/components/shared/shortlists-tab.tsx` | Renderiza `ScreeningQueue` acima dos cartões quando `entityType === "person"`. |
| `docs/memory.md` | Registro da decisão. |

---

### Task 1: Lógica pura do corte

**Files:**
- Create: `src/lib/screening.ts`
- Test: `src/lib/screening.test.ts`

**Interfaces:**
- Produces:
  - `type CutKey = { created_at: string; id: string }`
  - `farthest(rows: CutKey[]): CutKey` — a linha mais adiantada na ordem congelada (menor `created_at`; em empate, maior `id`). Lança `Error("farthest: lista vazia")` com array vazio.
  - `afterCutFilter(cut: CutKey): string` — string para `.or(...)` do PostgREST: `created_at.lt.<c>,and(created_at.eq.<c>,id.gt.<id>)`.

- [ ] **Step 1: Escrever os testes**

```ts
// src/lib/screening.test.ts
import { describe, it, expect } from "vitest"
import { farthest, afterCutFilter } from "./screening"

describe("farthest", () => {
  it("escolhe o menor created_at", () => {
    const out = farthest([
      { created_at: "2026-08-26T02:59:54+00:00", id: "aaaa" },
      { created_at: "2026-03-01T03:17:19+00:00", id: "bbbb" },
    ])
    expect(out.id).toBe("bbbb")
  })

  it("em empate de created_at, escolhe o maior id", () => {
    const out = farthest([
      { created_at: "2026-03-01T03:17:19+00:00", id: "aaaa" },
      { created_at: "2026-03-01T03:17:19+00:00", id: "cccc" },
      { created_at: "2026-03-01T03:17:19+00:00", id: "bbbb" },
    ])
    expect(out.id).toBe("cccc")
  })

  it("um so elemento devolve ele", () => {
    const only = { created_at: "2026-03-01T03:17:19+00:00", id: "aaaa" }
    expect(farthest([only])).toEqual(only)
  })

  it("lista vazia lanca", () => {
    expect(() => farthest([])).toThrow(/vazia/)
  })
})

describe("afterCutFilter", () => {
  it("monta o or do PostgREST com a chave do corte", () => {
    const out = afterCutFilter({ created_at: "2026-03-01T03:17:19.240507+00:00", id: "3318959c-7956-4b44-8cb7-6029ce8dc73d" })
    expect(out).toBe(
      "created_at.lt.2026-03-01T03:17:19.240507+00:00,and(created_at.eq.2026-03-01T03:17:19.240507+00:00,id.gt.3318959c-7956-4b44-8cb7-6029ce8dc73d)"
    )
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/screening.test.ts`
Expected: FAIL, módulo `./screening` não encontrado.

- [ ] **Step 3: Implementar**

```ts
// src/lib/screening.ts
/**
 * Chave de ordenação da fila de triagem: a mesma que o /people usa
 * (created_at desc, id asc). Dentro de um lote de import todo mundo tem o
 * mesmo created_at, então o id é o que dá posição estável.
 */
export type CutKey = { created_at: string; id: string }

/**
 * A linha mais adiantada na ordem congelada. Marcar várias de uma vez move o
 * cursor até a mais baixa da tela, não até a última clicada.
 */
export function farthest(rows: CutKey[]): CutKey {
  if (rows.length === 0) throw new Error("farthest: lista vazia")
  return rows.reduce((best, row) => {
    if (row.created_at < best.created_at) return row
    if (row.created_at === best.created_at && row.id > best.id) return row
    return best
  })
}

/**
 * "Depois do corte" em PostgREST. Quem está no corte não entra: a pessoa
 * marcada some junto com quem estava acima dela.
 */
export function afterCutFilter(cut: CutKey): string {
  return `created_at.lt.${cut.created_at},and(created_at.eq.${cut.created_at},id.gt.${cut.id})`
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/screening.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/screening.ts src/lib/screening.test.ts
git commit -m "feat(triagem): chave do corte e filtro da fila"
```

---

### Task 2: Migração e tipo

**Files:**
- Create: `supabase/migrations/017_screening_cursors.sql`
- Modify: `src/types/database.ts` (depois de `ShortlistMember`, linha ~225)

**Interfaces:**
- Produces: tabela `screening_cursors(workspace_id, user_id, entity_type, cut_created_at, cut_id, updated_at)`; tipo `ScreeningCursor`.

- [ ] **Step 1: Escrever a migração**

```sql
-- 017_screening_cursors.sql
-- Cursor de triagem: onde cada pessoa parou ao percorrer a própria fila de
-- contatos de cima para baixo marcando shortlist.
-- Ver docs/superpowers/specs/2026-09-10-triagem-por-cursor-design.md
--
-- RODAR INTEIRA, DE UMA VEZ, NO SQL EDITOR DO SUPABASE.

begin;

-- cut_created_at + cut_id é a chave de ordenação do último contato triado
-- (a fila é created_at desc, id asc). Sem FK para people de propósito: se o
-- contato for apagado, o corte continua no mesmo lugar da fila.
--
-- entity_type entra já, mesmo com a fila só de pessoas: a PK sem ele teria
-- que ser refeita quando empresas entrarem, e o custo hoje é uma coluna.
create table screening_cursors (
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  entity_type     text not null check (entity_type in ('person', 'company')),
  cut_created_at  timestamptz not null,
  cut_id          uuid not null,
  updated_at      timestamptz not null default now(),
  primary key (workspace_id, user_id, entity_type)
);

comment on table screening_cursors is
  'Onde cada usuário parou na fila de triagem. Só marcações feitas de dentro da fila movem isto.';

create trigger screening_cursors_updated_at
  before update on screening_cursors
  for each row execute function handle_updated_at();

alter table screening_cursors enable row level security;

-- Cada um lê e escreve só o próprio cursor, dentro do próprio workspace.
create policy screening_cursors_own on screening_cursors for all
  using (workspace_id = current_workspace() and user_id = auth.uid())
  with check (workspace_id = current_workspace() and user_id = auth.uid());

-- Ponto de partida, medido nas marcações existentes em 2026-09-10:
--   Guilherme parou em Fátima Leal (última da triagem corrida de 13/03).
--   Rafael parou em Ricardo Paiva (26/08).
-- A chave sai da própria linha da pessoa, não de literal, para não divergir.
insert into screening_cursors (workspace_id, user_id, entity_type, cut_created_at, cut_id)
select p.workspace_id, u.id, 'person', p.created_at, p.id
  from people p
  join auth.users u on u.email = 'gq.monteiro@gmail.com'
 where p.id = '3318959c-7956-4b44-8cb7-6029ce8dc73d'
on conflict do nothing;

insert into screening_cursors (workspace_id, user_id, entity_type, cut_created_at, cut_id)
select p.workspace_id, u.id, 'person', p.created_at, p.id
  from people p
  join auth.users u on u.email = 'rafael@lumeis.ai'
 where p.id = 'eb3bbb54-8336-4dce-ba89-9b59d194de8f'
on conflict do nothing;

commit;
```

- [ ] **Step 2: Adicionar o tipo**

Em `src/types/database.ts`, logo após a interface `ShortlistMember`:

```ts
export interface ScreeningCursor {
  workspace_id: string
  user_id: string
  entity_type: ShortlistEntityType
  cut_created_at: string
  cut_id: string
  updated_at: string
}
```

- [ ] **Step 3: Conferir tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/017_screening_cursors.sql src/types/database.ts
git commit -m "feat(triagem): tabela screening_cursors com seed dos dois cursores"
```

A migração é aplicada à mão pelo usuário no SQL Editor. Anotar isso no relatório final.

---

### Task 3: Tabela com ordenação desligável

**Files:**
- Modify: `src/components/people/people-table-columns.tsx` (ColumnOptions linha 15-24, SortHeader linha 26-51, chamada linha 54)
- Modify: `src/components/people/people-table.tsx` (props linha 19-33, chamada de `getPeopleColumns` linha 58)

**Interfaces:**
- Produces: `PeopleTable` aceita `sortable?: boolean` (default `true`). Com `false`, os cabeçalhos Name, Title e Company viram texto e `onSortChange` nunca é chamado.

- [ ] **Step 1: `sortable` em ColumnOptions e SortHeader**

Em `people-table-columns.tsx`:

```ts
interface ColumnOptions {
  onUpdate: (id: string, data: Partial<Person>) => void
  onDelete: (id: string) => void
  sortBy?: string
  sortDirection?: "asc" | "desc"
  onSortChange: (column: string) => void
  /** false na fila de triagem: a ordem lá é congelada e o cabeçalho não pode sugerir o contrário. */
  sortable?: boolean
  shortlistsByPerson?: Record<string, { id: string; name: string }[]>
  ownersByPerson?: Record<string, string[]>
  memberEmails?: Record<string, string>
}

function SortHeader({
  label,
  column,
  sortBy,
  sortDirection,
  onSortChange,
  sortable = true,
}: {
  label: string
  column: string
  sortBy?: string
  sortDirection?: "asc" | "desc"
  onSortChange: (column: string) => void
  sortable?: boolean
}) {
  if (!sortable) return <span>{label}</span>
  const active = sortBy === column
  const Icon = active ? (sortDirection === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8"
      onClick={() => onSortChange(column)}
    >
      {label}
      <Icon className="ml-1 h-3.5 w-3.5" />
    </Button>
  )
}
```

Na assinatura de `getPeopleColumns`, acrescentar `sortable = true` à desestruturação e passar `sortable={sortable}` nas três chamadas de `<SortHeader ... />` (Name, Title, Company).

- [ ] **Step 2: Repassar em PeopleTable**

Em `people-table.tsx`, adicionar à interface `PeopleTableProps`:

```ts
  /** false congela a ordem: cabeçalhos sem botão de ordenar. */
  sortable?: boolean
```

Desestruturar `sortable = true` nos parâmetros e passar `sortable` para `getPeopleColumns({ ..., sortable })`.

- [ ] **Step 3: Conferir**

Run: `npx tsc --noEmit && npx eslint src/components/people`
Expected: sem erros. O `/people` não muda porque o default é `true`.

- [ ] **Step 4: Commit**

```bash
git add src/components/people/people-table-columns.tsx src/components/people/people-table.tsx
git commit -m "feat(people): tabela com ordenacao desligavel"
```

---

### Task 4: Hook da fila

**Files:**
- Create: `src/hooks/use-screening-queue.ts`

**Interfaces:**
- Consumes: `farthest`, `afterCutFilter`, `CutKey` de `@/lib/screening`; `useWorkspace` (`workspaceId`, `userId`); `useShortlists("person")` (`shortlists`, `addMembers`); tipo `ScreeningCursor`.
- Produces:

```ts
export function useScreeningQueue(): {
  people: Person[]
  totalCount: number
  loading: boolean
  page: number
  totalPages: number
  goToPage: (p: number) => void
  cursorName: string | null        // nome de quem está no corte; null sem cursor
  cursorDeleted: boolean            // true se há cursor mas a pessoa foi apagada
  hasCursor: boolean
  mark: (ids: string[]) => Promise<void>
  updatePerson: (id: string, data: Partial<Person>) => Promise<boolean>
  deletePerson: (id: string) => Promise<boolean>
  refetch: () => void
}
```

- [ ] **Step 1: Escrever o hook**

```ts
// src/hooks/use-screening-queue.ts
"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { useWorkspace } from "@/lib/workspace/context"
import { useShortlists } from "@/hooks/use-shortlists"
import { farthest, afterCutFilter, type CutKey } from "@/lib/screening"
import { toast } from "sonner"
import type { Person, ScreeningCursor } from "@/types/database"

const PAGE_SIZE = 25

/**
 * A fila de triagem do usuário logado: os contatos de que ele é dono, na
 * ordem congelada do /people (created_at desc, id asc), a partir de onde ele
 * parou. Marcar entra na shortlist mais antiga e avança o cursor; só isto
 * move o cursor — marcar pelo /people, pelo diálogo ou pelo MCP não mexe.
 */
export function useScreeningQueue() {
  const { workspaceId, userId } = useWorkspace()
  const { shortlists, addMembers } = useShortlists("person")

  const [cursor, setCursor] = useState<CutKey | null>(null)
  const [cursorLoaded, setCursorLoaded] = useState(false)
  const [cursorName, setCursorName] = useState<string | null>(null)
  const [cursorDeleted, setCursorDeleted] = useState(false)

  const [people, setPeople] = useState<Person[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  const loadCursor = useCallback(async () => {
    if (!workspaceId || !userId) return
    const supabase = createClient()
    const { data } = await supabase
      .from("screening_cursors")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .eq("entity_type", "person")
      .maybeSingle()

    const row = data as ScreeningCursor | null
    if (!row) {
      setCursor(null)
      setCursorName(null)
      setCursorDeleted(false)
      setCursorLoaded(true)
      return
    }
    setCursor({ created_at: row.cut_created_at, id: row.cut_id })

    // Nome à parte porque o cursor não tem FK: a pessoa pode ter sido apagada
    // e o corte continua valendo mesmo assim.
    const { data: person } = await supabase
      .from("people")
      .select("full_name")
      .eq("id", row.cut_id)
      .maybeSingle()
    setCursorName((person as { full_name: string } | null)?.full_name ?? null)
    setCursorDeleted(!person)
    setCursorLoaded(true)
  }, [workspaceId, userId])

  useEffect(() => {
    loadCursor()
  }, [loadCursor])

  const fetchPage = useCallback(async (pageNum: number) => {
    if (!cursorLoaded || !userId) return
    setLoading(true)
    const supabase = createClient()

    // !inner + eq no dono: só quem tem vínculo comigo. A PK de people_owners é
    // (person_id, user_id), então ninguém casa duas vezes e a contagem é exata.
    let query = supabase
      .from("people")
      .select("*, company:companies(*), people_owners!inner(user_id)", { count: "exact" })
      .eq("people_owners.user_id", userId)

    if (cursor) {
      query = query.or(afterCutFilter(cursor))
    }

    const { data, count, error } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1)

    if (!error && data) {
      setPeople(data as Person[])
      setTotalCount(count ?? 0)
    }
    setLoading(false)
  }, [cursorLoaded, userId, cursor])

  useEffect(() => {
    setPage(0)
    fetchPage(0)
  }, [fetchPage])

  const goToPage = useCallback((p: number) => {
    const clamped = Math.max(0, Math.min(p, totalPages - 1))
    setPage(clamped)
    fetchPage(clamped)
  }, [totalPages, fetchPage])

  const refetch = useCallback(() => {
    fetchPage(page)
  }, [fetchPage, page])

  const mark = useCallback(async (ids: string[]) => {
    if (ids.length === 0 || !workspaceId || !userId) return
    if (shortlists.length === 0) {
      toast.error("Crie uma shortlist antes de triar")
      return
    }
    const target = shortlists[shortlists.length - 1] // a mais antiga, como no /people

    const ok = await addMembers(target.id, ids)
    if (!ok) {
      toast.error("Não deu para adicionar à shortlist")
      return
    }

    const marked = people.filter((p) => ids.includes(p.id))
    if (marked.length === 0) return
    const next = farthest(marked.map((p) => ({ created_at: p.created_at, id: p.id })))

    const supabase = createClient()
    const { error } = await supabase
      .from("screening_cursors")
      .upsert(
        { workspace_id: workspaceId, user_id: userId, entity_type: "person", cut_created_at: next.created_at, cut_id: next.id },
        { onConflict: "workspace_id,user_id,entity_type" }
      )

    if (error) {
      toast.error(`Entrou em "${target.name}", mas o corte não avançou`)
      refetch()
      return
    }

    toast.success(`Adicionado a "${target.name}"`)
    // Trocar o cursor dispara fetchPage(0) pelo efeito acima.
    await loadCursor()
  }, [workspaceId, userId, shortlists, addMembers, people, refetch, loadCursor])

  async function updatePerson(id: string, data: Partial<Person>) {
    if (!workspaceId) return false
    const supabase = createClient()
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, ...data } : p)))
    const { error } = await supabase.from("people").update(data).eq("id", id).eq("workspace_id", workspaceId)
    if (error) {
      refetch()
      return false
    }
    return true
  }

  async function deletePerson(id: string) {
    if (!workspaceId) return false
    const supabase = createClient()
    setPeople((prev) => prev.filter((p) => p.id !== id))
    setTotalCount((prev) => prev - 1)
    const { error } = await supabase.from("people").delete().eq("id", id).eq("workspace_id", workspaceId)
    if (error) {
      refetch()
      return false
    }
    return true
  }

  return {
    people,
    totalCount,
    loading: loading || !cursorLoaded,
    page,
    totalPages,
    goToPage,
    cursorName,
    cursorDeleted,
    hasCursor: cursor !== null,
    mark,
    updatePerson,
    deletePerson,
    refetch,
  }
}
```

- [ ] **Step 2: Conferir**

Run: `npx tsc --noEmit && npx eslint src/hooks/use-screening-queue.ts`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-screening-queue.ts
git commit -m "feat(triagem): hook da fila com cursor por usuario"
```

---

### Task 5: Componente e encaixe na aba

**Files:**
- Create: `src/components/people/screening-queue.tsx`
- Modify: `src/components/shared/shortlists-tab.tsx` (imports linha 1-14; retorno linha 100-116 e 118)

**Interfaces:**
- Consumes: `useScreeningQueue`, `useShortlistMemberships("person")`, `PeopleTable` com `sortable={false}`.
- Produces: `<ScreeningQueue />` sem props.

- [ ] **Step 1: Escrever o componente**

```tsx
// src/components/people/screening-queue.tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { useScreeningQueue } from "@/hooks/use-screening-queue"
import { useShortlistMemberships } from "@/hooks/use-shortlists"
import { PeopleTable } from "@/components/people/people-table"
import { CheckCircle2 } from "lucide-react"
import { toast } from "sonner"

/**
 * A fila de triagem: o /people só com os meus contatos, a partir de onde eu
 * parei. Marcar o checkbox entra na shortlist e encolhe a fila até o marcado.
 */
export function ScreeningQueue() {
  const {
    people, totalCount, loading, page, totalPages, goToPage,
    cursorName, cursorDeleted, hasCursor, mark, updatePerson, deletePerson,
  } = useScreeningQueue()
  const { shortlistsByEntity, refetch: refetchMemberships } = useShortlistMemberships("person")
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // Mesmo padrão do /people: só o que acabou de ser marcado dispara a ação.
  // A tabela não limpa a seleção quando a fila recarrega, então o id marcado
  // continua em selectedIds e este ref é o que evita marcar duas vezes.
  const prevSelectedRef = useRef<string[]>([])
  useEffect(() => {
    const prev = new Set(prevSelectedRef.current)
    const newlySelected = selectedIds.filter((id) => !prev.has(id))
    prevSelectedRef.current = selectedIds
    if (newlySelected.length === 0) return
    mark(newlySelected).then(() => refetchMemberships())
  }, [selectedIds, mark, refetchMemberships])

  const where = cursorDeleted
    ? "Você parou em um contato que foi apagado."
    : hasCursor && cursorName
      ? `Você parou em ${cursorName}.`
      : "Começando do topo."

  if (!loading && totalCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border py-10 text-center">
        <CheckCircle2 className="mb-3 h-8 w-8 text-muted-foreground/60" />
        <p className="text-sm font-medium">Triagem concluída.</p>
        <p className="text-sm text-muted-foreground">{where}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Triagem</h2>
        <p className="text-sm text-muted-foreground">
          {loading ? "Carregando…" : `${totalCount.toLocaleString("pt-BR")} para triar. ${where}`}
        </p>
      </div>
      <PeopleTable
        people={people}
        loading={loading}
        page={page}
        totalPages={totalPages}
        totalCount={totalCount}
        onPageChange={goToPage}
        onUpdate={(id, data) => { updatePerson(id, data).then((ok) => { if (!ok) toast.error("Failed to update") }) }}
        onDelete={(id) => { deletePerson(id).then((ok) => { ok ? toast.success("Contact deleted") : toast.error("Failed to delete") }) }}
        onSortChange={() => {}}
        sortable={false}
        onSelectionChange={setSelectedIds}
        shortlistsByPerson={shortlistsByEntity}
      />
    </div>
  )
}
```

- [ ] **Step 2: Encaixar em ShortlistsTab**

Em `shortlists-tab.tsx`:

1. Importar: `import { ScreeningQueue } from "@/components/people/screening-queue"`.
2. O estado vazio atual ("No shortlists yet") e a lista de cartões continuam iguais, mas passam a vir depois da fila. Trocar os dois `return` finais (o de `shortlists.length === 0` e o principal) por um único:

```tsx
  return (
    <div className="space-y-6">
      {entityType === "person" && <ScreeningQueue />}

      {shortlists.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ListPlus className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium mb-1">No shortlists yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Select {entityType === "person" ? "contacts" : "companies"} from the main list using the checkboxes,
            then click &quot;Add to Shortlist&quot; to create one.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* grid de cartões e tabela de membros, exatamente como estão hoje */}
        </div>
      )}
    </div>
  )
```

O comentário acima é só para situar: mover o JSX existente do `<div className="space-y-4">` (grid dos cartões + bloco `expandedId`) para dentro do ramo `else`, sem alterar nada dentro dele. O `if (loading)` com os skeletons fica como está.

- [ ] **Step 3: Conferir**

Run: `npx tsc --noEmit && npx eslint src/components && npm test`
Expected: sem erros; todos os testes passam.

- [ ] **Step 4: Commit**

```bash
git add src/components/people/screening-queue.tsx src/components/shared/shortlists-tab.tsx
git commit -m "feat(triagem): fila de triagem no topo da aba Shortlists"
```

---

### Task 6: Verificação ponta a ponta e registro

**Files:**
- Modify: `docs/memory.md` (acrescentar entrada no fim)

Pré-requisito: a migração 017 aplicada no SQL Editor do Supabase. Sem ela, a fila carrega sem cursor e mostra a lista inteira do dono, e `mark` falha no upsert.

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: build passa, sem erro de tipo nem de lint.

- [ ] **Step 2: Conferir no navegador (dev na porta que o `next dev` indicar)**

1. Abrir `/people`, aba Shortlists, logado como gq.monteiro@gmail.com.
2. Linha de contexto: "1.852 para triar. Você parou em Fátima Leal." Se a migração não foi aplicada ainda, aparece "4.278 para triar. Começando do topo." e o passo 4 falha no upsert.
3. Cabeçalhos Name, Title e Company sem ícone de ordenar.
4. Marcar o checkbox da terceira linha. Esperado: toast `Adicionado a "First"`, a fila recarrega e as três primeiras linhas sumiram; a contagem cai em 3; a linha de contexto mostra o nome da pessoa marcada.
5. Voltar à aba All People: a pessoa marcada tem a etiqueta "First". Ordenação por coluna continua funcionando ali.
6. Marcar alguém pelo checkbox no All People. Voltar à aba Shortlists: a contagem da fila não mudou.

- [ ] **Step 3: Registrar em docs/memory.md**

Acrescentar ao fim:

```markdown
---

## 2026-09-10 — Triagem por cursor

- **O que:** fila de triagem no topo da aba Shortlists do `/people`. Mostra só os contatos do usuário logado, na ordem congelada do `/people` (`created_at desc, id asc`), a partir de onde ele parou. Marcar entra na "First" e encolhe a fila até o marcado.
- **Cursor, não derivação:** `screening_cursors` guarda (`cut_created_at`, `cut_id`) por usuário. Só marcações feitas de dentro da fila movem o cursor. Marcar pelo `/people`, pelo diálogo ou pelo MCP entra na shortlist e não toca no corte. Motivo: uma marcação avulsa de 20/04 estava 265 linhas à frente de onde a triagem corrida parou.
- **Por que não "quem marcou":** `shortlist_members` não grava quem marcou, e atribuir pelo dono falha nas 700 pessoas em comum (todas marcadas antes do Rafael existir no workspace).
- **Ponto de partida:** Guilherme em Fátima Leal (restam 1.852), Rafael em Ricardo Paiva (restam 1.732). Seed na migração 017.
- **Ordem real da tela:** lote de 26/08 (Rafael) em cima, lote de fev/mar embaixo; dentro de um lote a ordem é por id. Congelada na fila; o `/people` continua ordenável.
- Spec: `docs/superpowers/specs/2026-09-10-triagem-por-cursor-design.md`
```

- [ ] **Step 4: Commit**

```bash
git add docs/memory.md
git commit -m "docs: registro da triagem por cursor"
```
