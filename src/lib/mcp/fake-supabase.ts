import type { SupabaseClient } from "@supabase/supabase-js"

export interface RecordedCall {
  table: string
  op: "insert" | "update" | "select" | "delete"
  payload?: unknown
  filters: Record<string, unknown>
}

export interface FakeSupabase {
  client: SupabaseClient
  calls: RecordedCall[]
}

/**
 * Cliente Supabase falso que só grava o que foi chamado.
 *
 * Existe porque as tools de escrita precisam de teste de invariante — "isto
 * subiu last_client_event_at?" — e um banco real não cabe num teste de unidade.
 * `rows` alimenta os selects, indexado por nome de tabela.
 */
export function fakeSupabase(rows: Record<string, unknown[]> = {}): FakeSupabase {
  const calls: RecordedCall[] = []

  function builder(table: string, op: RecordedCall["op"], payload?: unknown) {
    const call: RecordedCall = { table, op, payload, filters: {} }
    calls.push(call)

    const chain: Record<string, unknown> = {
      eq(col: string, val: unknown) {
        call.filters[col] = val
        return chain
      },
      not() {
        return chain
      },
      gte() {
        return chain
      },
      lte() {
        return chain
      },
      lt() {
        return chain
      },
      gt() {
        return chain
      },
      ilike(col: string, val: unknown) {
        call.filters[col] = val
        return chain
      },
      order() {
        return chain
      },
      limit() {
        return chain
      },
      select() {
        return chain
      },
      single() {
        return Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null })
      },
      maybeSingle() {
        return Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null })
      },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve)
      },
    }

    return chain
  }

  const client = {
    from(table: string) {
      return {
        select: () => builder(table, "select"),
        insert: (payload: unknown) => builder(table, "insert", payload),
        update: (payload: unknown) => builder(table, "update", payload),
        delete: () => builder(table, "delete"),
      }
    },
  } as unknown as SupabaseClient

  return { client, calls }
}
