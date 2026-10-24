// O dia do evento é o de São Paulo, igual à revisão diária do CRM.

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
const hhmmFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false })

/** Timestamp do WhatsApp (segundos) → "AAAA-MM-DD" em São Paulo. */
export function saoPauloDay(tsSeconds: number): string {
  return dayFmt.format(new Date(tsSeconds * 1000))
}

export function saoPauloHHMM(tsSeconds: number): string {
  return hhmmFmt.format(new Date(tsSeconds * 1000))
}
