import { describe, it, expect } from "vitest"
import { saoPauloDay, saoPauloHHMM } from "./day"
import { groupKey, indexDirectory, nameKey } from "./directory"

describe("dia de São Paulo", () => {
  it("01:30 UTC ainda é o dia anterior em São Paulo", () => {
    const ts = Date.parse("2026-10-23T01:30:00Z") / 1000
    expect(saoPauloDay(ts)).toBe("2026-10-22")
    expect(saoPauloHHMM(ts)).toBe("22:30")
  })
})

describe("índice do diretório", () => {
  const idx = indexDirectory({
    generatedAt: "x",
    people: [
      { id: "p1", nameKey: "joao silva", companyId: "c1" },
      { id: "p2", nameKey: "joao silva", companyId: "c2" },
    ],
    companies: [{ id: "c1", nameKey: "acme" }],
    phones: [{ digits: ["5521987654321", "552187654321"], personId: "p1", ignored: false }],
    groups: [{ groupId: "120@g.us", companyId: "c1", ignored: false }],
  })
  it("telefone por qualquer variante", () => {
    expect(idx.personByPhone.get("552187654321")).toEqual({ personId: "p1", ignored: false })
  })
  it("homônimos ficam juntos na mesma chave", () => {
    expect(idx.peopleByName.get("joao silva")!.map((p) => p.id)).toEqual(["p1", "p2"])
  })
  it("chaves de nome iguais às do CRM", () => {
    expect(nameKey("João  SILVA")).toBe("joao silva")
    expect(groupKey("Lumeis <> ACME Ltda.")).toBe("lumeis acme")
  })
})
