# Tasks: Import CSV/XLSX

## Modulo: Importacao em Massa

### Task 4.1: Parsers
- **Status:** DONE
- **Arquivos:** `src/lib/import/parse-csv.ts`, `src/lib/import/parse-xlsx.ts`
- **Descricao:**
  - CSV: papaparse com auto-detect de delimitador e header
  - XLSX: SheetJS lendo primeira aba, header na primeira linha
  - Retornam `{ headers: string[], rows: Record<string, string>[] }`
- **Criterio:** Parse de arquivos comuns funciona

### Task 4.2: Auto-Mapper de Colunas
- **Status:** DONE
- **Arquivo:** `src/lib/import/map-columns.ts`
- **Descricao:** Mapeia headers do arquivo para campos do sistema usando aliases fuzzy (lowercase, trim). Ex: "First Name" → first_name, "Company" → current_company
- **Criterio:** Headers comuns sao detectados automaticamente

### Task 4.3: Validador de Linhas
- **Status:** DONE
- **Arquivo:** `src/lib/import/validate-row.ts`
- **Descricao:** Valida cada linha: first_name obrigatorio (ou split de full_name), email formato, etc. Retorna `{ valid, errors[], data }` por linha
- **Criterio:** Linhas invalidas marcadas corretamente

### Task 4.4: Hook useImport
- **Status:** DONE
- **Arquivo:** `src/hooks/use-import.ts`
- **Descricao:** State machine com steps: upload → mapping → preview → executing → done. Batch insert de 50 em 50 com progresso. Auto-cria companies. Pessoas importadas ficam com kanban_column_id = null
- **Criterio:** Import completo com contagem de sucesso/erro

### Task 4.5: UI do Wizard
- **Status:** DONE
- **Arquivo:** `src/app/(dashboard)/import/page.tsx`
- **Descricao:** 4 passos visuais:
  1. Upload (drag & drop + file select)
  2. Mapping (dropdowns por coluna)
  3. Preview (tabela com validacao verde/vermelho)
  4. Execution (progress bar + resultado)
- **Criterio:** Fluxo completo funciona end-to-end

### Task 4.6: Import History
- **Status:** DONE
- **Descricao:** Cada import grava registro em `import_history` com filename, tipo, contagens, erros, status
- **Criterio:** Registros persistem no banco
