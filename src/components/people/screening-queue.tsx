"use client"

import { useEffect, useRef, useState } from "react"
import { useScreeningQueue } from "@/hooks/use-screening-queue"
import { useShortlistMemberships } from "@/hooks/use-shortlists"
import { PeopleTable } from "@/components/people/people-table"
import { Button } from "@/components/ui/button"
import { CheckCircle2, Loader2, Undo2 } from "lucide-react"
import { toast } from "sonner"

/**
 * A fila de triagem: o /people só com os meus contatos, a partir de onde eu
 * parei. Marcar o checkbox entra na shortlist e encolhe a fila até o marcado.
 */
export function ScreeningQueue() {
  const {
    people, totalCount, loading, page, totalPages, goToPage,
    cursorName, cursorDeleted, hasCursor, mark, undo, canUndo, undoing, updatePerson, deletePerson,
  } = useScreeningQueue()
  const { shortlistsByEntity, refetch: refetchMemberships } = useShortlistMemberships("person")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  // Desfazer remonta a tabela: a pessoa que volta para a fila não pode voltar
  // com o checkbox ainda marcado, senão marcá-la de novo não dispara nada.
  const [tableKey, setTableKey] = useState(0)

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

  const handleUndo = async () => {
    await undo()
    prevSelectedRef.current = []
    setSelectedIds([])
    setTableKey((k) => k + 1)
    refetchMemberships()
  }

  const undoButton = canUndo ? (
    <Button variant="outline" size="sm" onClick={handleUndo} disabled={undoing}>
      {undoing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Undo2 className="mr-2 h-4 w-4" />}
      Desfazer
    </Button>
  ) : null

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
        {undoButton && <div className="mt-4">{undoButton}</div>}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Triagem</h2>
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">
            {loading ? "Carregando…" : `${totalCount.toLocaleString("pt-BR")} para triar. ${where}`}
          </p>
          {undoButton}
        </div>
      </div>
      <PeopleTable
        key={tableKey}
        people={people}
        loading={loading}
        page={page}
        totalPages={totalPages}
        totalCount={totalCount}
        onPageChange={goToPage}
        onUpdate={(id, data) => { updatePerson(id, data).then((ok) => { if (!ok) toast.error("Failed to update") }) }}
        onDelete={(id) => { deletePerson(id).then((ok) => { if (ok) toast.success("Contact deleted"); else toast.error("Failed to delete") }) }}
        onSortChange={() => {}}
        sortable={false}
        onSelectionChange={setSelectedIds}
        shortlistsByPerson={shortlistsByEntity}
      />
    </div>
  )
}
