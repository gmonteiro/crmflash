import { COLUMN_ALIASES } from "@/lib/constants"

export function autoMapColumns(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}

  for (const header of headers) {
    const normalized = header.toLowerCase().trim()

    // Direct match in aliases
    if (COLUMN_ALIASES[normalized]) {
      mapping[header] = COLUMN_ALIASES[normalized]
      continue
    }

    // Fuzzy: check if header contains any alias
    let matched = false
    for (const [alias, field] of Object.entries(COLUMN_ALIASES)) {
      if (normalized.includes(alias) || alias.includes(normalized)) {
        mapping[header] = field
        matched = true
        break
      }
    }

    if (!matched) {
      mapping[header] = "__skip__"
    }
  }

  return mapping
}
