import type { KanbanColumn, Person } from './database'

export interface KanbanColumnWithCards extends KanbanColumn {
  cards: Person[]
}

export interface KanbanBoardData {
  columns: KanbanColumnWithCards[]
}

export type DragType = 'card' | 'column'

export interface CardDragData {
  type: 'card'
  person: Person
  columnId: string
}

export interface ColumnDragData {
  type: 'column'
  column: KanbanColumn
}
