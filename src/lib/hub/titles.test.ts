import { describe, it, expect } from "vitest"
import { equivalentTitles, titleKey } from "./titles"

describe("titleKey", () => {
  it("ignora acento, caixa e pontuação", () => {
    expect(titleKey("Enviar PROPOSTA, já!")).toBe(titleKey("enviar proposta ja"))
  })
})

describe("equivalentTitles", () => {
  it("mesmo passo com artigos e preposições diferentes", () => {
    expect(equivalentTitles("Enviar proposta de piloto", "Enviar a proposta do piloto")).toBe(true)
  })
  it("um título contido no outro, com ao menos duas palavras", () => {
    expect(equivalentTitles("Enviar proposta", "Enviar proposta de piloto")).toBe(true)
  })
  it("verbo igual com objeto diferente não é o mesmo passo", () => {
    expect(equivalentTitles("Enviar contrato", "Enviar proposta")).toBe(false)
    expect(equivalentTitles("Agendar workshop", "Enviar proposta de piloto")).toBe(false)
  })
  it("uma palavra só nunca casa por aproximação, só por igualdade", () => {
    expect(equivalentTitles("Proposta", "Enviar proposta de piloto")).toBe(false)
    expect(equivalentTitles("Proposta", "proposta")).toBe(true)
  })
})
