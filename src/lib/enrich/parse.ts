export function stripCiteTags(text: string): string {
  return text
    .replace(/<\/?cite[^>]*>/g, "")
    .replace(/\[(\d+)\]\(https?:\/\/[^)]*\)/g, "")  // [1](url)
    .replace(/\[(\d+)\]/g, "")                        // [1], [2]
    .replace(/【[^】]*】/g, "")                         // 【citation】
}

export function extractJson<T>(text: string): T | null {
  const clean = stripCiteTags(text)
  const codeBlockMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim())
    } catch { /* fall through */ }
  }
  const jsonMatch = clean.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0])
    } catch { /* fall through */ }
  }
  return null
}

export function extractJsonArray<T>(text: string): T[] | null {
  const clean = stripCiteTags(text)
  const codeBlockMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim())
      return Array.isArray(parsed) ? parsed : null
    } catch { /* fall through */ }
  }
  const arrayMatch = clean.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0])
      return Array.isArray(parsed) ? parsed : null
    } catch { /* fall through */ }
  }
  return null
}
