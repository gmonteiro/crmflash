import { parsePhoneNumberFromString } from "libphonenumber-js"

// Normalização das chaves de identidade. Tudo aqui é determinístico e puro:
// a mesma entrada dá a mesma chave em qualquer fonte, e é isso que permite que
// um e-mail visto no Calendar case com o mesmo e-mail visto no Gmail.

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"])

// Domínios que NUNCA ligam empresa: muita gente de cliente usa e-mail pessoal,
// e "gmail.com → empresa X" contaminaria todos os e-mails futuros.
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.com.br",
  "outlook.com",
  "outlook.com.br",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.com.br",
  "icloud.com",
  "me.com",
  "uol.com.br",
  "bol.com.br",
  "terra.com.br",
  "globo.com",
  "globomail.com",
  "ig.com.br",
  "proton.me",
  "protonmail.com",
])

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null
  const email = raw.trim().toLowerCase().replace(/^mailto:/, "")
  const at = email.lastIndexOf("@")
  if (at <= 0 || at === email.length - 1) return null
  let local = email.slice(0, at)
  const domain = email.slice(at + 1)
  if (!domain.includes(".")) return null
  // No Gmail, pontos e +tag não mudam a caixa de entrada. Mesma regra do
  // backfill da migração 020.
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.split("+")[0].replace(/\./g, "")
    return `${local}@gmail.com`
  }
  return `${local}@${domain}`
}

export function emailDomain(email: string | null | undefined): string | null {
  const norm = normalizeEmail(email)
  if (!norm) return null
  return norm.slice(norm.lastIndexOf("@") + 1)
}

/** Domínio de site ou de e-mail, sem esquema, www e caminho. */
export function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null
  let d = raw.trim().toLowerCase()
  if (d.includes("@")) d = d.slice(d.lastIndexOf("@") + 1)
  d = d.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "")
  return d.includes(".") ? d : null
}

export function isFreeMailDomain(domain: string | null | undefined): boolean {
  return !!domain && FREE_MAIL_DOMAINS.has(domain)
}

export function internalDomains(env: string | undefined = process.env.LUMEIS_INTERNAL_DOMAINS): Set<string> {
  return new Set(
    (env ?? "")
      .split(",")
      .map((d) => normalizeDomain(d))
      .filter((d): d is string => !!d)
  )
}

export function isInternalEmail(email: string | null | undefined, internal: Set<string>): boolean {
  const domain = emailDomain(email)
  return !!domain && internal.has(domain)
}

/**
 * Telefone → E.164. Região padrão BR.
 *
 * Armadilha brasileira: celular antigo às vezes aparece sem o nono dígito
 * (o wa_id do WhatsApp faz isso). Com DDI 55, 10 dígitos nacionais e o
 * assinante começando em 6–9, a forma canônica ganha o 9.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const hasPlus = raw.trim().startsWith("+")
  const digits = raw.replace(/\D/g, "")
  if (digits.length < 8) return null
  // wa_id vem sem "+": "5521987654321". Com 12–13 dígitos começando em 55, é DDI.
  const input = hasPlus || (digits.startsWith("55") && digits.length >= 12) ? `+${digits}` : digits
  const parsed = parsePhoneNumberFromString(input, "BR")
  if (!parsed) return null
  const country = parsed.countryCallingCode as string
  let national = parsed.nationalNumber as string
  if (country === "55") {
    if (national.length === 10 && /[6-9]/.test(national[2])) {
      national = `${national.slice(0, 2)}9${national.slice(2)}`
    }
    if (national.length !== 10 && national.length !== 11) return null
  } else if (!parsed.isPossible()) {
    return null
  }
  return `+${country}${national}`
}

/** As formas em que o mesmo celular brasileiro pode chegar: com e sem o nono dígito. */
export function phoneVariants(e164: string): string[] {
  const m = e164.match(/^\+55(\d{2})9(\d{8})$/)
  if (!m) return [e164]
  return [e164, `+55${m[1]}${m[2]}`]
}

const HONORIFICS = new Set(["sr", "sra", "srta", "dr", "dra", "prof", "profa", "eng", "mr", "mrs", "ms"])

function foldText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
}

/** Nome de pessoa → tokens comparáveis (sem acento, caixa, tratamento, pontuação). */
export function personNameTokens(raw: string | null | undefined): string[] {
  if (!raw) return []
  return foldText(raw)
    .replace(/\([^)]*\)/g, " ") // "João (joao@x.com)"
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !HONORIFICS.has(t))
}

export function normalizePersonName(raw: string | null | undefined): string | null {
  const tokens = personNameTokens(raw)
  return tokens.length ? tokens.join(" ") : null
}

/**
 * Dois nomes podem ser a mesma pessoa? Primeiro nome igual e, se os dois têm
 * sobrenome, o último sobrenome compatível ("João S." casa com "João Silva").
 * Só nome sem sobrenome ("João") casa com qualquer João — por isso a escada
 * nunca usa isto sozinho fora do mundo fechado de uma reunião.
 */
export function namesCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = personNameTokens(a)
  const tb = personNameTokens(b)
  if (!ta.length || !tb.length) return false
  if (ta[0] !== tb[0]) return false
  if (ta.length === 1 || tb.length === 1) return true
  const la = ta[ta.length - 1]
  const lb = tb[tb.length - 1]
  if (la === lb) return true
  if (la.length === 1) return lb.startsWith(la)
  if (lb.length === 1) return la.startsWith(lb)
  return false
}

/**
 * Nome de empresa → chave. TEM que dar o mesmo resultado de company_name_key()
 * da migração 020: sem acento, minúsculo, pontuação vira espaço, sufixos
 * societários no fim saem.
 */
export function companyNameKey(raw: string | null | undefined): string | null {
  if (!raw) return null
  const spaced = foldText(raw).replace(/[^a-z0-9]+/g, " ").trim()
  const key = ` ${spaced}`.replace(/( (ltda|sa|s a|me|epp|eireli|inc|llc|ltd|cia))+$/, "").trim()
  return key || null
}

/** "acme.com.br" → "acme": o rótulo que costuma ser o nome da empresa. */
export function domainLabel(domain: string): string {
  const parts = domain.split(".")
  const generic = new Set(["com", "br", "net", "org", "io", "ai", "co", "gov", "edu", "app", "tech"])
  while (parts.length > 1 && generic.has(parts[parts.length - 1])) parts.pop()
  return parts[parts.length - 1]
}

/** "João Silva (joao@acme.com)" → { name: "João Silva", email: "joao@acme.com" } */
export function splitNameAndEmail(raw: string | null | undefined): { name: string | null; email: string | null } {
  if (!raw) return { name: null, email: null }
  const m = raw.match(/^(.*?)\s*[(<]\s*([^()<>\s]+@[^()<>\s]+)\s*[)>]\s*$/)
  if (m) return { name: m[1].trim() || null, email: normalizeEmail(m[2]) }
  if (raw.includes("@") && !raw.includes(" ")) return { name: null, email: normalizeEmail(raw) }
  return { name: raw.trim() || null, email: null }
}
