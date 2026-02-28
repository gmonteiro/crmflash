# Tasks: People

## Modulo: CRUD de Pessoas

### Task 2.1: Hook usePeople
- **Status:** DONE
- **Arquivos:** `src/hooks/use-people.ts`
- **Descricao:** Hook com fetch paginado (25/pg), busca por nome (ilike), filtro por categoria, ordenacao, createPerson, updatePerson (otimista), deletePerson (otimista), refetch
- **Detalhe:** createPerson NAO atribui kanban_column_id (pessoa fica fora do board)
- **Criterio:** CRUD funciona, paginacao correta, busca filtra

### Task 2.2: Hook usePerson
- **Status:** DONE
- **Arquivo:** `src/hooks/use-people.ts`
- **Descricao:** Hook para carregar uma pessoa por ID com join em companies. Expoe update e refetch (useCallback)
- **Criterio:** Detail page carrega dados corretos

### Task 2.3: Tabela de People
- **Status:** DONE
- **Arquivo:** `src/app/(dashboard)/people/page.tsx`
- **Descricao:** Tabela com @tanstack/react-table, colunas sortable, paginacao, search bar, category filter
- **Criterio:** Renderiza corretamente, paginacao funciona

### Task 2.4: Formulario Add Person
- **Status:** DONE
- **Arquivo:** `src/components/people/add-person-dialog.tsx`
- **Descricao:** Dialog com react-hook-form + zod validation. Campos: first_name*, last_name*, email, phone, linkedin_url, current_title, current_company, company_id (CompanySelect), category, notes
- **Criterio:** Valida campos obrigatorios, cria pessoa no banco

### Task 2.5: Detail Page
- **Status:** DONE
- **Arquivo:** `src/app/(dashboard)/people/[id]/page.tsx`
- **Descricao:** Carrega pessoa via usePerson, renderiza PersonDetailCard. Passa refetch como onRefetch
- **Criterio:** Navegar para /people/[id] exibe dados corretos

### Task 2.6: PersonDetailCard
- **Status:** DONE
- **Arquivo:** `src/components/people/person-detail-card.tsx`
- **Descricao:** Card com avatar (iniciais), nome, titulo, empresa (link), email, phone, linkedin, categoria, notas. Toggle de edicao inline. Botao EnrichButton (AI). Mostra data de enriquecimento
- **Criterio:** Edicao salva, enrich funciona, link empresa navega

### Task 2.7: Delete Person
- **Status:** DONE
- **Descricao:** Botao delete na tabela, otimista com rollback
- **Criterio:** Remove da lista e do banco
