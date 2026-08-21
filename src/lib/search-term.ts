// O termo digitado vai parar dentro de um filtro `ilike` do PostgREST, e dois
// grupos de caracteres sao perigosos ali:
//
//   %  _        curingas do LIKE. Um "%" digitado casaria com o catalogo
//               inteiro, e nao da pra escapar sem clausula ESCAPE, que o
//               PostgREST nao expoe.
//   , ( ) " \   separadores da propria sintaxe de filtro. Um nome como
//               "Acme, Inc" quebraria a query em duas condicoes invalidas.
//
// Tirar esses caracteres e preferivel a rejeitar a busca: quem digita virgula
// quer achar a empresa, nao escrever uma query.
const UNSAFE = /[%_,()"\\]/g

export function toIlikePattern(term: string): string {
  const cleaned = term.replace(UNSAFE, " ").replace(/\s+/g, " ").trim()
  return cleaned ? `%${cleaned}%` : ""
}
