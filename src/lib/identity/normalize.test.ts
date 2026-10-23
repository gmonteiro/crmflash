import { describe, it, expect } from "vitest"
import {
  companyNameKey,
  domainLabel,
  emailDomain,
  internalDomains,
  isFreeMailDomain,
  namesCompatible,
  normalizeDomain,
  normalizeEmail,
  normalizePersonName,
  normalizePhone,
  phoneVariants,
  splitNameAndEmail,
} from "./normalize"

describe("normalizeEmail", () => {
  it("caixa e espaços", () => {
    expect(normalizeEmail("  Joao@Acme.com.BR ")).toBe("joao@acme.com.br")
  })
  it("gmail ignora pontos e +tag, googlemail vira gmail", () => {
    expect(normalizeEmail("Joao.Silva+crm@gmail.com")).toBe("joaosilva@gmail.com")
    expect(normalizeEmail("joao.silva@googlemail.com")).toBe("joaosilva@gmail.com")
  })
  it("outros domínios preservam pontos e +", () => {
    expect(normalizeEmail("joao.silva+x@acme.com")).toBe("joao.silva+x@acme.com")
  })
  it("recusa lixo", () => {
    expect(normalizeEmail("joao")).toBeNull()
    expect(normalizeEmail("@acme.com")).toBeNull()
    expect(normalizeEmail("joao@localhost")).toBeNull()
    expect(normalizeEmail(null)).toBeNull()
  })
})

describe("domínios", () => {
  it("extrai e normaliza", () => {
    expect(emailDomain("Joao@ACME.com.br")).toBe("acme.com.br")
    expect(normalizeDomain("https://www.acme.com.br/sobre")).toBe("acme.com.br")
    expect(normalizeDomain("contato@acme.com")).toBe("acme.com")
  })
  it("genéricos nunca são empresa", () => {
    expect(isFreeMailDomain("gmail.com")).toBe(true)
    expect(isFreeMailDomain("uol.com.br")).toBe(true)
    expect(isFreeMailDomain("acme.com.br")).toBe(false)
  })
  it("internos vêm do env", () => {
    const set = internalDomains("lumeis.ai, https://www.lumeis.com.br")
    expect([...set]).toEqual(["lumeis.ai", "lumeis.com.br"])
  })
  it("rótulo do domínio", () => {
    expect(domainLabel("acme.com.br")).toBe("acme")
    expect(domainLabel("vendas.acme.io")).toBe("acme")
  })
})

describe("normalizePhone", () => {
  it("formatos brasileiros diferentes, mesma chave", () => {
    const expected = "+5521987654321"
    expect(normalizePhone("(21) 98765-4321")).toBe(expected)
    expect(normalizePhone("+55 21 98765-4321")).toBe(expected)
    expect(normalizePhone("5521987654321")).toBe(expected) // wa_id
    expect(normalizePhone("021 98765 4321")).toBe(expected)
  })
  it("celular sem o nono dígito ganha o 9", () => {
    expect(normalizePhone("552187654321")).toBe("+5521987654321") // wa_id antigo
    expect(normalizePhone("(21) 8765-4321")).toBe("+5521987654321")
  })
  it("fixo não ganha 9", () => {
    expect(normalizePhone("(21) 3456-7890")).toBe("+552134567890")
  })
  it("internacional", () => {
    expect(normalizePhone("+1 (415) 555-2671")).toBe("+14155552671")
  })
  it("variantes cobrem o wa_id sem 9", () => {
    expect(phoneVariants("+5521987654321")).toEqual(["+5521987654321", "+552187654321"])
    expect(phoneVariants("+14155552671")).toEqual(["+14155552671"])
  })
  it("recusa lixo", () => {
    expect(normalizePhone("123")).toBeNull()
    expect(normalizePhone("")).toBeNull()
  })
})

describe("nomes de pessoa", () => {
  it("normaliza acento, caixa, tratamento e e-mail entre parênteses", () => {
    expect(normalizePersonName("Dr. João  SILVA (joao@acme.com)")).toBe("joao silva")
  })
  it("compatibilidade: inicial, sobrenome, só primeiro nome", () => {
    expect(namesCompatible("João S.", "Joao Silva")).toBe(true)
    expect(namesCompatible("João", "João Silva")).toBe(true)
    expect(namesCompatible("João Souza", "João Silva")).toBe(false)
    expect(namesCompatible("Maria", "João")).toBe(false)
    expect(namesCompatible("", "João")).toBe(false)
  })
})

describe("companyNameKey", () => {
  it("razão social e grafias diferentes dão a mesma chave", () => {
    const k = companyNameKey("Acme")
    expect(k).toBe("acme")
    expect(companyNameKey("ACME Ltda.")).toBe(k)
    expect(companyNameKey("Acme S/A")).toBe(k)
    expect(companyNameKey("Acme S.A.")).toBe(k)
    expect(companyNameKey("  acme  ltda  ME ")).toBe(k)
  })
  it("acento e pontuação", () => {
    expect(companyNameKey("Farmácias São João")).toBe("farmacias sao joao")
    expect(companyNameKey("Zona-Sul")).toBe("zona sul")
  })
  it("sufixo só sai do fim", () => {
    expect(companyNameKey("Me Poupe")).toBe("me poupe")
  })
  it("vazio vira null", () => {
    expect(companyNameKey("Ltda")).toBeNull()
    expect(companyNameKey(null)).toBeNull()
  })
})

describe("splitNameAndEmail", () => {
  it("formato do TranscriptionApp", () => {
    expect(splitNameAndEmail("João Silva (Joao@Acme.com)")).toEqual({
      name: "João Silva",
      email: "joao@acme.com",
    })
    expect(splitNameAndEmail("Pessoa 2")).toEqual({ name: "Pessoa 2", email: null })
    expect(splitNameAndEmail("joao@acme.com")).toEqual({ name: null, email: "joao@acme.com" })
  })
})
