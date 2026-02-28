import type { KanbanColumn, Company } from './database'

export interface KanbanColumnWithCards extends KanbanColumn {
  cards: Company[]
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
