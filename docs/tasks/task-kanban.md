# Tasks: Kanban Board

## Modulo: Pipeline Visual

### Task 5.1: Fractional Indexing
- **Status:** DONE
- **Arquivo:** `src/lib/kanban/position.ts`
- **Descricao:** Funcao `calculatePosition(cards, targetIndex)` que calcula posicao fracionaria entre vizinhos para evitar reindex
- **Criterio:** Posicoes corretas em todos os cenarios (inicio, meio, fim, vazio)

### Task 5.2: Hook useKanban
- **Status:** DONE
- **Arquivo:** `src/hooks/use-kanban.ts`
- **Descricao:**
  - `fetchBoard` — carrega colunas + people com kanban_column_id != null
  - `moveCard(personId, targetColumnId, targetIndex)` — move card com update otimista
  - `reorderColumns(activeId, overIndex)` — reordena colunas
  - `addColumn(title, color)` — cria nova coluna
  - `updateColumn(id, data)` — renomeia/recolore
  - `deleteColumn(id, moveToColumnId?)` — deleta coluna, move ou limpa cards
  - `addPersonToBoard(personId, columnId?)` — adiciona pessoa ao board (default: primeira coluna)
  - `removePersonFromBoard(personId)` — remove pessoa do board (seta null)
- **Criterio:** Todas as operacoes funcionam com update otimista

### Task 5.3: KanbanProviders
- **Status:** DONE
- **Arquivo:** `src/components/kanban/kanban-providers.tsx`
- **Descricao:** Wrapper com DndContext + SortableContext, sensors (pointer + keyboard), collision detection
- **Criterio:** Drag funciona suavemente

### Task 5.4: KanbanColumn
- **Status:** DONE
- **Arquivo:** `src/components/kanban/kanban-column.tsx`
- **Descricao:** Coluna sortable/droppable, header com titulo + count + menu (rename, delete), lista de cards
- **Criterio:** Renderiza cards, aceita drops

### Task 5.5: KanbanCard
- **Status:** DONE
- **Arquivo:** `src/components/kanban/kanban-card.tsx`
- **Descricao:** Card draggable mostrando nome, titulo, empresa. Link para detail page
- **Criterio:** Drag funciona, link navega

### Task 5.6: AddColumnDialog
- **Status:** DONE
- **Arquivo:** `src/components/kanban/add-column-dialog.tsx`
- **Descricao:** Dialog com input titulo + color picker (8 cores pre-definidas)
- **Criterio:** Cria coluna com cor selecionada

### Task 5.7: AddPersonDialog
- **Status:** DONE
- **Arquivo:** `src/components/kanban/add-person-dialog.tsx`
- **Descricao:** Dialog com: select de coluna destino, busca por nome (filtra kanban_column_id IS NULL), lista clicavel, debounce 300ms, loading state
- **Criterio:** Busca funciona, click adiciona ao board na coluna selecionada

### Task 5.8: KanbanBoard (composicao)
- **Status:** DONE
- **Arquivo:** `src/components/kanban/kanban-board.tsx`
- **Descricao:** Componente principal que compoe tudo: loading skeleton, DndContext, colunas, botao Add Person, botao Add Column. handleDragEnd com logica para card-on-card, card-on-column, column reorder
- **Criterio:** Board completo funcional

### Task 5.9: Remover Auto-Assign
- **Status:** DONE
- **Descricao:** Removido auto-assign de kanban ao criar pessoa (usePeople) e ao importar (useImport). Pessoas novas ficam com kanban_column_id = null
- **Criterio:** Criar pessoa → nao aparece no kanban. Importar → idem
