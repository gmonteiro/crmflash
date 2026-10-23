import { describe, it, expect, beforeEach } from "vitest"
import { MemoryHubStore } from "./memory-store"
import { composeDigest, runDailyReview, todayInSaoPaulo, type DailyVerdict, type Reviewer, type ReviewCompany } from "./daily-review"

const NOW = Date.parse("2026-10-24T10:00:00Z") // 07:00 em Brasília
const ACME: ReviewCompany = {
  id: "co-acme",
  name: "Acme",
  stageTitle: "Diagnóstico",
  daysInStage: 12,
  lastClientEventAt: "2026-10-20T14:00:00.000Z",
  championName: "João",
  painHypothesis: "conciliação manual",
  signals: [],
  openNextSteps: [],
}
const BETA: ReviewCompany = { ...ACME, id: "co-beta", name: "Beta", stageTitle: "Contato", lastClientEventAt: null }
const GELADO: ReviewCompany = { ...ACME, id: "co-gelo", name: "Gelo", stageTitle: "Gelado" }

class ScriptedReviewer implements Reviewer {
  calls = 0
  constructor(private out: () => DailyVerdict) {}
  async review() {
    this.calls++
    return this.out()
  }
}
const advance = (): DailyVerdict => ({
  verdict: "avanco",
  rationale: "João mandou o export do ERP e marcou a próxima conversa.",
  evidence_ids: ["act-1", "inventado-9"],
  stage_suggestion: { target_stage: "Dor validada", rationale: "dor quantificada" },
  next_step: { title: "Enviar diagnóstico por escrito", due_date: "2026-10-28", rationale: "fechar Diagnóstico" },
})

let store: MemoryHubStore
beforeEach(() => {
  store = new MemoryHubStore()
  store.reviewCompanies = [ACME, BETA, GELADO]
  store.reviewEvents.set("co-acme", [
    {
      id: "act-1",
      kind: "email.received",
      title: "E-mail: Export do ERP",
      description: "segue o export",
      occurredAt: "2026-10-23T15:00:00.000Z",
      clientEngaged: true,
      createdAt: "2026-10-23T15:05:00.000Z",
    },
  ])
})

describe("revisão diária", () => {
  it("só contas ativas; sem evento novo vira estagnação sem chamar o modelo", async () => {
    const reviewer = new ScriptedReviewer(advance)
    const r = await runDailyReview(store, reviewer, { now: NOW })
    expect(r.today).toBe("2026-10-24")
    expect(r.results.map((x) => [x.name, x.verdict, x.ai])).toEqual([
      ["Acme", "avanco", true],
      ["Beta", "estagnacao", false],
    ])
    expect(reviewer.calls).toBe(1)
    expect(store.dailyReviews.get("co-beta|2026-10-24")!.rationale).toContain("Nenhum contato do cliente registrado")
  })

  it("descarta evidência que não está na lista de eventos", async () => {
    await runDailyReview(store, new ScriptedReviewer(advance), { now: NOW })
    expect(store.dailyReviews.get("co-acme|2026-10-24")!.evidenceActivityIds).toEqual(["act-1"])
  })

  it("estágio e próximo passo entram como PROPOSTA; o estágio não muda", async () => {
    await runDailyReview(store, new ScriptedReviewer(advance), { now: NOW })
    const infs = [...store.inferences.values()]
    expect(infs.map((i) => [i.field.split(":")[0], i.status]).sort()).toEqual([
      ["next_step", "proposed"],
      ["stage_suggestion", "proposed"],
    ])
    expect(store.reviewCompanies[0].stageTitle).toBe("Diagnóstico")
  })

  it("estágio inventado não vira proposta", async () => {
    const odd = () => ({ ...advance(), stage_suggestion: { target_stage: "Fechadíssimo", rationale: "x" }, next_step: null })
    await runDailyReview(store, new ScriptedReviewer(odd), { now: NOW })
    expect([...store.inferences.values()]).toHaveLength(0)
    expect(store.dailyReviews.get("co-acme|2026-10-24")!.stageSuggestion).toBeNull()
  })

  it("IDEMPOTÊNCIA: rodar de novo no mesmo dia não refaz nem gasta modelo", async () => {
    const reviewer = new ScriptedReviewer(advance)
    await runDailyReview(store, reviewer, { now: NOW })
    const second = await runDailyReview(store, reviewer, { now: NOW })
    expect(reviewer.calls).toBe(1)
    expect(second.results.every((x) => x.skipped === "ja_revisada_hoje")).toBe(true)
    expect(store.dailyReviews.size).toBe(2)
    expect(store.inferences.size).toBe(2)
  })

  it("só a conta pedida, com company_id", async () => {
    const r = await runDailyReview(store, new ScriptedReviewer(advance), { now: NOW, companyId: "co-beta" })
    expect(r.results.map((x) => x.name)).toEqual(["Beta"])
  })

  it("falha do modelo numa conta não derruba as outras", async () => {
    const boom: Reviewer = { review: async () => Promise.reject(new Error("API caiu")) }
    const r = await runDailyReview(store, boom, { now: NOW })
    expect(r.failed).toEqual([{ companyId: "co-acme", error: "API caiu" }])
    expect(r.results.map((x) => x.name)).toEqual(["Beta"])
    // A Acme não ficou marcada como revisada: amanhã (ou rodando de novo) tenta outra vez.
    expect(store.dailyReviews.has("co-acme|2026-10-24")).toBe(false)
  })

  it("o dia é o de Brasília, não o UTC", () => {
    expect(todayInSaoPaulo(Date.parse("2026-10-24T02:00:00Z"))).toBe("2026-10-23")
  })
})

describe("resumo por e-mail", () => {
  it("ordem: riscos, sugestões, fila, avanços; sem novidade, nada", async () => {
    const rows = [
      { companyId: "a", companyName: "A", reviewDate: "2026-10-24", verdict: "avanco" as const, rationale: "andou", evidenceActivityIds: [], model: "m", promptVersion: "p", stageSuggestion: "Prova", nextStep: null },
      { companyId: "b", companyName: "B <x>", reviewDate: "2026-10-24", verdict: "risco" as const, rationale: "sumiu", evidenceActivityIds: [], model: "m", promptVersion: "p", stageSuggestion: null, nextStep: null },
      { companyId: "c", companyName: "C", reviewDate: "2026-10-24", verdict: "estagnacao" as const, rationale: "nada", evidenceActivityIds: [], model: "m", promptVersion: "p", stageSuggestion: null, nextStep: null },
    ]
    const d = composeDigest("2026-10-24", rows, 2, "https://crm.example")!
    expect(d.subject).toBe("CRM 2026-10-24: 1 risco, 1 sugestão, 1 avanço")
    const order = ["Riscos", "Sugestões", "Fila de identidade", "Avanços"].map((h) => d.html.indexOf(h))
    expect(order).toEqual([...order].sort((x, y) => x - y))
    expect(d.html).toContain("B &lt;x&gt;")
    expect(d.html).toContain('href="https://crm.example/companies/a"')
    expect(d.html).not.toContain(">C<")

    expect(composeDigest("2026-10-24", [rows[2]], 0, "https://crm.example")).toBeNull()
  })
})
