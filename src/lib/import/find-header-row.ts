import { matchColumn } from "./map-columns"

/**
 * Nem toda planilha comeca no cabecalho. O export de conexoes do LinkedIn abre
 * com tres linhas de recado antes dele:
 *
 *   Notes:
 *   "When exporting your connection data, you may notice that some of the..."
 *   (vazia)
 *   First Name,Last Name,URL,Email Address,Company,Position,Connected On
 *
 * Lido de cima, o arquivo tem uma coluna so, chamada "Notes:". Nada mapeia para
 * first_name, e o import devolve "Name is required" em todas as 3.961 linhas —
 * um erro que fala de nome quando o problema e o cabecalho.
 */

// Fundo de planilha e ruido de topo. Cabecalho depois da decima linha e mais
// provavel ser coincidencia em dado de verdade do que cabecalho de verdade.
const SCAN_LIMIT = 10

// Uma coincidencia isolada nao basta: "Notes:" sozinho ja casa com o alias
// 'notes'. Duas colunas reconhecidas na mesma linha e o que separa cabecalho
// de frase solta.
const MIN_FIELDS = 2

/** Quantos campos distintos o mapeador reconhece nesta linha. */
function knownFields(row: string[]): number {
  const fields = new Set<string>()

  for (const cell of row) {
    const field = matchColumn(cell)
    if (field) fields.add(field)
  }

  return fields.size
}

/**
 * Indice da linha que parece o cabecalho. Zero quando nenhuma convence — a
 * planilha pode usar nomes que o mapeador nao conhece, e ai a primeira linha
 * continua sendo o melhor palpite e o usuario corrige no mapeamento manual.
 */
export function findHeaderRow(table: string[][]): number {
  let best = 0
  let bestScore = 0

  for (let i = 0; i < Math.min(table.length, SCAN_LIMIT); i++) {
    const score = knownFields(table[i])

    // Estritamente maior: no empate fica a primeira, que e a mais alta no
    // arquivo. Linha de dado que casa por acaso vem sempre depois.
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }

  return bestScore >= MIN_FIELDS ? best : 0
}

/** Cabecalhos utilizaveis: sem vazios, sem repetidos. */
function nameColumns(row: string[]): string[] {
  const used = new Set<string>()

  return row.map((cell, i) => {
    const base = cell.trim() || `Column ${i + 1}`

    let name = base
    for (let n = 2; used.has(name); n++) name = `${base} (${n})`

    used.add(name)
    return name
  })
}

/**
 * Tabela crua -> cabecalho + linhas, pulando o que vier antes do cabecalho.
 * Compartilhado por CSV e XLSX: o preambulo sobrevive a um "salvar como xlsx".
 */
export function tableToRows(table: string[][]): {
  headers: string[]
  rows: Record<string, string>[]
} {
  if (table.length === 0) return { headers: [], rows: [] }

  const headerRow = findHeaderRow(table)
  const headers = nameColumns(table[headerRow])

  const rows = table.slice(headerRow + 1).map((cells) => {
    const row: Record<string, string> = {}
    headers.forEach((header, i) => {
      row[header] = cells[i] ?? ""
    })
    return row
  })

  return { headers, rows }
}
