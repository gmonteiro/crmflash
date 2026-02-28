# Tasks: Companies

## Modulo: CRUD de Empresas

### Task 3.1: Hook useCompanies
- **Status:** DONE
- **Arquivo:** `src/hooks/use-companies.ts`
- **Descricao:** Hook com fetch paginado, busca por nome, filtro por industria, createCompany, updateCompany, deleteCompany, refetch
- **Criterio:** CRUD funciona

### Task 3.2: Tabela de Companies
- **Status:** DONE
- **Arquivo:** `src/app/(dashboard)/companies/page.tsx`
- **Descricao:** Tabela com colunas: Nome, Industria, Size Tier, Employees, Website. Search + filtro por industria
- **Criterio:** Renderiza, pagina, filtra

### Task 3.3: Formulario Add Company
- **Status:** DONE
- **Arquivo:** `src/components/companies/add-company-dialog.tsx`
- **Descricao:** Dialog com campos: name*, domain, linkedin_url, industry (select das constantes), size_tier (select), estimated_revenue, employee_count, description, website
- **Criterio:** Cria empresa no banco

### Task 3.4: Detail Page
- **Status:** DONE
- **Arquivo:** `src/app/(dashboard)/companies/[id]/page.tsx`
- **Descricao:** Carrega empresa + people associadas

### Task 3.5: CompanyDetailCard
- **Status:** DONE
- **Arquivo:** `src/components/companies/company-detail-card.tsx`
- **Descricao:** Card com icone, nome, badges (industry, size_tier), descricao, links (website, linkedin), employee count, revenue. Lista de people associadas. Botao EnrichButton (AI) no header. load extraido como useCallback para refetch apos enrich
- **Criterio:** Dados exibidos, enrich atualiza, lista de people funciona

### Task 3.6: CompanySelect
- **Status:** DONE
- **Arquivo:** `src/components/people/company-select.tsx`
- **Descricao:** Combobox para selecionar empresa ao criar/editar pessoa
- **Criterio:** Busca e seleciona empresa corretamente
