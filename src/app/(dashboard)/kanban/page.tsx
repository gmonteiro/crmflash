"use client"

import { KanbanBoard } from "@/components/kanban/kanban-board"

export default function KanbanPage() {
  // Titulo e acoes vivem dentro do board: os dialogs precisam das colunas e dos
  // handlers do useKanban, e erguer esse estado ate a page so pra posicionar dois
  // botoes seria pior que o board ser dono do proprio cabecalho.
  return <KanbanBoard />
}
