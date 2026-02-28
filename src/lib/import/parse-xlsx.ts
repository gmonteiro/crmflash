import * as XLSX from "xlsx"
import type { ParseResult } from "./parse-csv"

export async function parseXlsx(file: File): Promise<ParseResult> {
  try {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: "array" })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const json = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" })

    if (json.length === 0) {
      return { headers: [], rows: [], errors: ["Empty spreadsheet"] }
    }

    const headers = Object.keys(json[0])
    return { headers, rows: json, errors: [] }
  } catch (err) {
    return {
      headers: [],
      rows: [],
      errors: [(err as Error).message],
    }
  }
}
