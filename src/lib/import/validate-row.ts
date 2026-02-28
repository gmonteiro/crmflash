export interface RowValidation {
  valid: boolean
  errors: string[]
  data: Record<string, string>
}

export function validateRow(
  row: Record<string, string>,
  mapping: Record<string, string>,
  rowIndex: number
): RowValidation {
  const errors: string[] = []
  const data: Record<string, string> = {}

  for (const [sourceCol, targetField] of Object.entries(mapping)) {
    if (targetField === "__skip__") continue
    const value = (row[sourceCol] || "").trim()
    data[targetField] = value
  }

  // Handle full_name splitting
  if (data.full_name && !data.first_name && !data.last_name) {
    const parts = data.full_name.trim().split(/\s+/)
    data.first_name = parts[0] || ""
    data.last_name = parts.slice(1).join(" ") || ""
    delete data.full_name
  }

  // Validate required fields
  if (!data.first_name && !data.last_name) {
    errors.push(`Row ${rowIndex + 1}: Name is required (first_name or last_name)`)
  }

  if (!data.first_name && data.last_name) {
    data.first_name = data.last_name
    data.last_name = ""
  }

  // Validate email format
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.push(`Row ${rowIndex + 1}: Invalid email "${data.email}"`)
  }

  return {
    valid: errors.length === 0,
    errors,
    data,
  }
}
