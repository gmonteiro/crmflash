import Papa from "papaparse"

export interface ParseResult {
  headers: string[]
  rows: Record<string, string>[]
  errors: string[]
}

export function parseCsv(file: File): Promise<ParseResult> {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        resolve({
          headers: results.meta.fields || [],
          rows: results.data as Record<string, string>[],
          errors: results.errors.map((e) => `Row ${e.row}: ${e.message}`),
        })
      },
      error(err) {
        resolve({ headers: [], rows: [], errors: [err.message] })
      },
    })
  })
}
