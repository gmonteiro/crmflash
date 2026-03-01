import * as XLSX from "xlsx"
import type { ParseResult } from "./parse-csv"

export async function parseXlsx(file: File): Promise<ParseResult> {
  try {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: "array" })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" })

    if (raw.length === 0) {
      return { headers: [], rows: [], errors: ["Empty spreadsheet"] }
    }

    // Coerce all cell values to strings (XLSX returns numbers, dates, booleans)
    const rows = raw.map((row) => {
      const stringRow: Record<string, string> = {}
      for (const [key, val] of Object.entries(row)) {
        stringRow[key] = val == null ? "" : String(val)
      }
      return stringRow
    })

    const headers = Object.keys(rows[0])
    return { headers, rows, errors: [] }
  } catch (err) {
    return {
      headers: [],
      rows: [],
      errors: [(err as Error).message],
    }
  }
}
