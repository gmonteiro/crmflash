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
        onDelete={(id) => { deletePerson(id).then((ok) => { if (ok) toast.success("Contact deleted"); else toast.error("Failed to delete") }) }}
        onSortChange={() => {}}
        sortable={false}
        onSelectionChange={setSelectedIds}
        shortlistsByPerson={shortlistsByEntity}
      />
    </div>
  )
}
