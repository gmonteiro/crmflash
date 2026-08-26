import { describe, it, expect } from "vitest"
import { findHeaderRow, tableToRows } from "./find-header-row"

// O topo literal de um "Connections.csv" exportado do LinkedIn.
const LINKEDIN = [
  ["Notes:"],
  [
    "When exporting your connection data, you may notice that some of the email" +
      " addresses are missing. You will only see email addresses for connections" +
      " who have allowed their connections to see or download their email address.",
  ],
  ["First Name", "Last Name", "URL", "Email Address", "Company", "Position", "Connected On"],
  ["Caroline", "Pessoa", "https://www.linkedin.com/in/carolinepessoa", "", "VTEX", "Project Analyst", "09 Apr 2026"],
  ["Denise", "Porto Hruby", "https://www.linkedin.com/in/denise-porto-hruby", "", "IAB Brasil", "CEO", "09 Apr 2026"],
]

describe("findHeaderRow", () => {
  it("pula o preambulo do LinkedIn", () => {
    expect(findHeaderRow(LINKEDIN)).toBe(2)
  })

  it("nao confunde a linha 'Notes:' com cabecalho", () => {
    // Sozinha ela casa com o alias 'notes'. Um acerto nao e cabecalho.
    expect(findHeaderRow([["Notes:"], ["First Name", "Last Name", "Company"]])).toBe(1)
  })

  it("fica na linha 0 quando o arquivo ja comeca no cabecalho", () => {
    expect(findHeaderRow([["First Name", "Email"], ["Ana", "ana@x.com"]])).toBe(0)
  })

  it("nao elege linha de dado so com celulas vazias", () => {
    // Os 90 contatos anonimizados do export: `,,,,,,02 Oct 2022`. Antes,
    // celula vazia casava com o primeiro alias e a linha pontuava alto.
    const table = [
      ["First Name", "Last Name", "Company"],
      ["", "", ""],
      ["Ana", "Silva", "VTEX"],
    ]
    expect(findHeaderRow(table)).toBe(0)
  })

  it("volta para a linha 0 quando nenhuma parece cabecalho", () => {
    // Planilha com nomes que o mapeador nao conhece: o usuario resolve no
    // mapeamento manual, e para isso precisa das colunas como estao.
    const table = [["colaborador", "setor"], ["Ana", "Vendas"]]
    expect(findHeaderRow(table)).toBe(0)
  })

  it("nao varre o arquivo inteiro atras de cabecalho", () => {
    const ruido = Array.from({ length: 12 }, () => ["x"])
    expect(findHeaderRow([...ruido, ["First Name", "Email"]])).toBe(0)
  })
})

describe("tableToRows", () => {
  it("descarta o preambulo e chaveia pelo cabecalho certo", () => {
    const { headers, rows } = tableToRows(LINKEDIN)

    expect(headers[0]).toBe("First Name")
    expect(rows).toHaveLength(2)
    expect(rows[0]["First Name"]).toBe("Caroline")
    expect(rows[0]["Company"]).toBe("VTEX")
    expect(rows[1]["Position"]).toBe("CEO")
  })

  it("nao deixa a linha de aviso virar contato", () => {
    const { rows } = tableToRows(LINKEDIN)
    expect(rows.some((r) => r["First Name"].startsWith("When exporting"))).toBe(false)
  })

  it("completa celula faltando no fim da linha", () => {
    // Planilha real corta a linha quando as ultimas colunas estao vazias.
    const { rows } = tableToRows([["First Name", "Last Name", "Company"], ["Ana"]])
    expect(rows[0]).toEqual({ "First Name": "Ana", "Last Name": "", Company: "" })
  })

  it("da nome a coluna sem cabecalho em vez de perde-la", () => {
    const { headers, rows } = tableToRows([["First Name", "", "Company"], ["Ana", "x", "VTEX"]])
    expect(headers).toEqual(["First Name", "Column 2", "Company"])
    expect(rows[0]["Column 2"]).toBe("x")
  })

  it("desambigua cabecalho repetido em vez de sobrescrever", () => {
    const { headers, rows } = tableToRows([["Email", "Email"], ["pessoal@x.com", "trabalho@x.com"]])
    expect(headers).toEqual(["Email", "Email (2)"])
    expect(rows[0]["Email"]).toBe("pessoal@x.com")
    expect(rows[0]["Email (2)"]).toBe("trabalho@x.com")
  })

  it("aguenta planilha vazia", () => {
    expect(tableToRows([])).toEqual({ headers: [], rows: [] })
  })
})
