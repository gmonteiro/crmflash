import Papa from "papaparse"
import { tableToRows } from "./find-header-row"

export interface ParseResult {
  headers: string[]
  rows: Record<string, string>[]
  errors: string[]
}

export function parseCsv(file: File): Promise<ParseResult> {
  return new Promise((resolve) => {
    // header: false porque a primeira linha nem sempre e o cabecalho — quem
    // decide isso e o tableToRows. Com header: true o papaparse ja teria
    // cravado "Notes:" como unica coluna antes de qualquer chance de olhar.
    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: true,
      complete(results) {
        const { headers, rows } = tableToRows(results.data)

        resolve({
          headers,
          rows,
          // e.row agora conta linhas do arquivo, nao linhas de dado. E o
          // numero que a pessoa acha abrindo a planilha.
          errors: results.errors.map((e) => `Row ${e.row}: ${e.message}`),
        })
      },
      error(err) {
        resolve({ headers: [], rows: [], errors: [err.message] })
      },
    })
  })
}
