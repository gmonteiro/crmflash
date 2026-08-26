import * as XLSX from "xlsx"
import type { ParseResult } from "./parse-csv"
import { tableToRows } from "./find-header-row"

export async function parseXlsx(file: File): Promise<ParseResult> {
  try {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: "array" })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]

    // header: 1 devolve matriz em vez de objetos ja chaveados pela primeira
    // linha. Mesmo motivo do CSV: quem escolhe o cabecalho e o tableToRows.
    // Preambulo sobrevive a "salvar como xlsx", e planilha montada a mao
    // costuma ter titulo e linha em branco no topo.
    const table = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      blankrows: false,
    })

    if (table.length === 0) {
      return { headers: [], rows: [], errors: ["Empty spreadsheet"] }
    }

    // XLSX devolve numero, data e booleano com seus tipos.
    const asText = table.map((row) =>
      row.map((cell) => (cell == null ? "" : String(cell)))
    )

    const { headers, rows } = tableToRows(asText)
    return { headers, rows, errors: [] }
  } catch (err) {
    return {
      headers: [],
      rows: [],
      errors: [(err as Error).message],
    }
  }
}
