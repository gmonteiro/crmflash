import { normalizePersonName } from "@/lib/identity/normalize"

// Quando dois próximos passos são "o mesmo passo". Usado onde duas fontes
// descrevem a MESMA reunião — a IA do hub e a revisão do TranscriptionApp —,
// para que uma não duplique a outra com outras palavras. Fora desse contexto
// (passos de reuniões diferentes) vale só a igualdade de titleKey: casar por
// aproximação com tarefa antiga engoliria passo novo.

export function titleKey(title: string): string {
  return normalizePersonName(title) ?? title.toLowerCase()
}

const STOPWORDS = new Set([
  "a", "o", "as", "os", "um", "uma", "uns", "umas", "de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos",
  "nas", "para", "pra", "pro", "com", "por", "ao", "aos", "que", "se", "ate", "sobre",
])

function contentTokens(title: string): Set<string> {
  return new Set(
    titleKey(title)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
  )
}

/**
 * Igualdade de titleKey; ou, com duas palavras de conteúdo ou mais dos dois
 * lados, Jaccard ≥ 0,6. "Enviar proposta" ≈ "Enviar a proposta do piloto";
 * "Enviar contrato" ≠ "Enviar proposta".
 */
export function equivalentTitles(a: string, b: string): boolean {
  if (titleKey(a) === titleKey(b)) return true
  const ta = contentTokens(a)
  const tb = contentTokens(b)
  if (ta.size < 2 || tb.size < 2) return false
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter) >= 0.6
}
