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
    // Função interna, como em use-owners: o linter do React Compiler trata a
    // chamada direta ao callback como setState síncrono dentro do efeito.
    async function run() {
      await loadCursor()
    }
    run()
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
      setPage(pageNum)
    }
    setLoading(false)
  }, [cursorLoaded, userId, cursor])

  // Cursor novo ou dono novo: a fila volta para a primeira página.
  useEffect(() => {
    async function run() {
      await fetchPage(0)
    }
    run()
  }, [fetchPage])

  const goToPage = useCallback((p: number) => {
    const clamped = Math.max(0, Math.min(p, totalPages - 1))
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
