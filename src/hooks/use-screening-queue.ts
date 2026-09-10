"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { useWorkspace } from "@/lib/workspace/context"
import { useShortlists } from "@/hooks/use-shortlists"
import { farthest, afterCutFilter, newlyAdded, type CutKey } from "@/lib/screening"
import { toast } from "sonner"
import type { Person, ScreeningCursor } from "@/types/database"

const PAGE_SIZE = 25

/** O que uma marcação fez, para poder desfazer: só vive nesta aba aberta. */
type UndoEntry = {
  previousCursor: CutKey | null
  shortlistId: string
  shortlistName: string
  addedIds: string[]
}

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
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  const [undoing, setUndoing] = useState(false)

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
    const supabase = createClient()

    // Antes de adicionar: quem já era membro não sai no desfazer.
    const { data: existingRows } = await supabase
      .from("shortlist_members")
      .select("person_id")
      .eq("shortlist_id", target.id)
      .in("person_id", ids)
    const existing = new Set(((existingRows ?? []) as { person_id: string }[]).map((r) => r.person_id))

    const ok = await addMembers(target.id, ids)
    if (!ok) {
      toast.error("Não deu para adicionar à shortlist")
      return
    }

    const marked = people.filter((p) => ids.includes(p.id))
    if (marked.length === 0) return
    const next = farthest(marked.map((p) => ({ created_at: p.created_at, id: p.id })))

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

    setUndoStack((prev) => [
      ...prev,
      { previousCursor: cursor, shortlistId: target.id, shortlistName: target.name, addedIds: newlyAdded(ids, existing) },
    ])
    toast.success(`Adicionado a "${target.name}"`)
    // Trocar o cursor dispara fetchPage(0) pelo efeito acima.
    await loadCursor()
  }, [workspaceId, userId, shortlists, addMembers, people, cursor, refetch, loadCursor])

  /**
   * Volta a última marcação feita nesta aba: tira da shortlist quem entrou por
   * ela e devolve o cursor para onde estava. Só o que foi feito aqui — marcar
   * pelo /people não entra na pilha.
   */
  const undo = useCallback(async () => {
    const entry = undoStack[undoStack.length - 1]
    if (!entry || !workspaceId || !userId || undoing) return
    setUndoing(true)
    const supabase = createClient()

    if (entry.addedIds.length > 0) {
      const { error } = await supabase
        .from("shortlist_members")
        .delete()
        .eq("shortlist_id", entry.shortlistId)
        .in("person_id", entry.addedIds)
      if (error) {
        toast.error("Não deu para tirar da shortlist")
        setUndoing(false)
        return
      }
    }

    const { error } = entry.previousCursor
      ? await supabase
          .from("screening_cursors")
          .upsert(
            {
              workspace_id: workspaceId,
              user_id: userId,
              entity_type: "person",
              cut_created_at: entry.previousCursor.created_at,
              cut_id: entry.previousCursor.id,
            },
            { onConflict: "workspace_id,user_id,entity_type" }
          )
      : await supabase
          .from("screening_cursors")
          .delete()
          .eq("workspace_id", workspaceId)
          .eq("user_id", userId)
          .eq("entity_type", "person")

    if (error) {
      toast.error(`Saiu de "${entry.shortlistName}", mas o corte não voltou`)
    } else {
      toast.success("Marcação desfeita")
    }
    setUndoStack((prev) => prev.slice(0, -1))
    setUndoing(false)
    await loadCursor()
  }, [undoStack, workspaceId, userId, undoing, loadCursor])

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
    undo,
    canUndo: undoStack.length > 0,
    undoing,
    updatePerson,
    deletePerson,
    refetch,
  }
}
