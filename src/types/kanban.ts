import type { KanbanColumn, Company } from './database'

// Company com campos derivados agregados no fetch do board (não persistidos).
export interface KanbanCardCompany extends Company {
  signalCount?: number
  nextStepDue?: string | null
}

export interface KanbanColumnWithCards extends KanbanColumn {
  cards: KanbanCardCompany[]
}

export interface KanbanBoardData {
  columns: KanbanColumnWithCards[]
}

export type DragType = 'card' | 'column'

export interface CardDragData {
  type: 'card'
  company: Company
  columnId: string
}

export interface ColumnDragData {
  type: 'column'
  column: KanbanColumn
}
