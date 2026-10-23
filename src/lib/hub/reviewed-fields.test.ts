import { describe, it, expect, beforeEach } from "vitest"
import { MemoryHubStore } from "./memory-store"
import { applyReviewedFields, REVIEWED_MODEL, type ReviewedFieldsInput } from "./reviewed-fields"
import { applyExtraction } from "./policy"
import type { Extraction } from "./extraction"

// O que o TranscriptionApp manda depois que você revisou a reunião, contra o
// mesmo store em memória que reproduz os índices únicos do banco. Os testes de
// idempotência rodam a mesma ingestão várias vezes e contam linhas.

const INTERNAL = new Set(["lumeis.ai"])
const ACME = "co-acme"
const MEETING = "m-1"

let store: MemoryHubStore
beforeEach(() => {
  store = new MemoryHubStore()
  store.addCompany({ id: ACME, name: "Acme", stageTitle: "Diagnóstico" })
})

function input(over: Partial<ReviewedFieldsInput> = {}): ReviewedFieldsInput {
  return {
    companyId: ACME,
    activityId: "act-1",
    meetingId: MEETING,
    meetingDate: "2026-10-10T16:00:00.000Z",
    appUrl: "https://www.transcriptionapp.com.br/meetings/m-1",
    nextSteps: [
      { title: "Enviar proposta de piloto", due_date: "2026-10-14", assignee: "Gabriel", source_action_item_id: "ai-1" },
      { title: "Agendar workshop com o time de TI", due_date: null, assignee: null, source_action_item_id: null },
    ],
    signals: [{ type: "asked_price", evidence: "Perguntou quanto custa um piloto" }],
    contacts: [{ name: "João Silva", role: "Gerente de Operações", email: null }],
    ...over,
  }
}

const counts = () => [
  store.nextSteps.size,
  store.signals.size,
  store.people.size,
  store.inferences.size,
  store.reviews.size,
  store.participants.size,
]

describe("próximos passos revisados", () => {
  it("cria com prazo e responsável, chave por pendência do app, proveniência humana com evidência", async () => {
    const r = await applyReviewedFields(store, input(), INTERNAL)

    expect(r.next_steps_created).toBe(2)
    const steps = [...store.nextSteps.values()]
    const proposta = steps.find((s) => s.title === "Enviar proposta de piloto")!
    expect(proposta).toMatchObject({
      dueDate: "2026-10-14",
      description: "Responsável: Gabriel",
      sourceRef: "tapp:m-1:h:item-ai-1",
      sourceActivityId: "act-1",
      status: "pending",
    })
    const inf = [...store.inferences.values()].find((i) => i.id === proposta.inferenceId)!
    expect(inf).toMatchObject({ model: REVIEWED_MODEL, status: "applied" })
    expect(inf.evidence[0]).toMatchObject({ kind: "manual", ref: MEETING })

    // Sem id de pendência, a chave sai do título.
    expect(steps.find((s) => s.title.startsWith("Agendar"))!.sourceRef).toMatch(/^tapp:m-1:h:t-[0-9a-f]{16}$/)
  })

  it("IDEMPOTÊNCIA: a mesma revisão três vezes não duplica nada", async () => {
    await applyReviewedFields(store, input(), INTERNAL)
    const before = counts()
    const second = await applyReviewedFields(store, input(), INTERNAL)
    await applyReviewedFields(store, input(), INTERNAL)
    expect(counts()).toEqual(before)
    expect(second).toMatchObject({ next_steps_created: 0, signals_captured: 0, contacts_created: 0 })
    expect(second.next_steps.map((s) => s.status)).toEqual(["existing", "existing"])
  })

  it("reenvio com o prazo editado no app atualiza o mesmo passo", async () => {
    await applyReviewedFields(store, input(), INTERNAL)
    const edited = input()
    edited.nextSteps[0] = { ...edited.nextSteps[0], due_date: "2026-10-21" }
    const r = await applyReviewedFields(store, edited, INTERNAL)
    expect(r.next_steps[0].status).toBe("updated")
    expect(store.nextSteps.size).toBe(2)
    expect(store.nextSteps.get("tapp:m-1:h:item-ai-1")!.dueDate).toBe("2026-10-21")
  })

  it("passo já concluído no CRM não é reaberto por reenvio", async () => {
    await applyReviewedFields(store, input(), INTERNAL)
    store.nextSteps.get("tapp:m-1:h:item-ai-1")!.status = "completed"
    const edited = input()
    edited.nextSteps[0] = { ...edited.nextSteps[0], due_date: "2026-10-21" }
    const r = await applyReviewedFields(store, edited, INTERNAL)
    expect(r.next_steps[0].status).toBe("existing")
    expect(store.nextSteps.get("tapp:m-1:h:item-ai-1")).toMatchObject({ status: "completed", dueDate: "2026-10-14" })
  })

  it("passo aberto de outra origem com o mesmo título não é duplicado", async () => {
    await store.insertNextStep({
      companyId: ACME,
      title: "Enviar proposta de piloto",
      description: null,
      dueDate: null,
      sourceRef: "manual-1",
      sourceActivityId: "act-0",
      inferenceId: null,
    })
    const r = await applyReviewedFields(store, input(), INTERNAL)
    expect(r.next_steps[0].status).toBe("existing")
    expect(store.nextSteps.size).toBe(2)
  })
})

describe("convivência com a IA do hub na MESMA reunião", () => {
  const extraction = (titles: string[]): Extraction => ({
    summary: "x",
    champion: null,
    economic_buyer: null,
    pain_hypothesis: null,
    signals: [{ type: "asked_price", evidence: [{ segment: 4, speaker: "João", quote: "Quanto custaria um piloto" }] }],
    next_steps: titles.map((title) => ({
      title,
      owner: "lumeis" as const,
      assignee: null,
      due_date: null,
      due_basis: "none" as const,
      evidence: [{ segment: 5, speaker: "Gabriel", quote: "Mando a proposta até quarta" }],
    })),
    stage_suggestion: null,
  })
  const meta = (version = "v1") => ({
    sourceActivityId: "held-1",
    sourceVersion: version,
    meetingId: MEETING,
    meetingDate: "2026-10-10T16:00:00.000Z",
    appUrl: null,
    model: "claude-opus-5-5",
  })
  const runHub = async (titles: string[], version = "v1") =>
    applyExtraction(store, (await store.companyContext(ACME))!, extraction(titles), meta(version))

  it("hub antes: o passo inferido equivalente é SUBSTITUÍDO pelo revisado, sem segunda linha", async () => {
    await runHub(["Enviar a proposta do piloto", "Receber export do ERP"])
    expect(store.nextSteps.size).toBe(2)
    const aiStep = [...store.nextSteps.values()].find((s) => s.title === "Enviar a proposta do piloto")!
    const aiInference = aiStep.inferenceId!

    const r = await applyReviewedFields(store, input({ nextSteps: [input().nextSteps[0]] }), INTERNAL)

    expect(r.next_steps[0].status).toBe("replaced_inferred")
    expect(store.nextSteps.size).toBe(2)
    const replaced = store.nextSteps.get("tapp:m-1:h:item-ai-1")!
    expect(replaced).toMatchObject({ title: "Enviar proposta de piloto", dueDate: "2026-10-14", description: "Responsável: Gabriel" })
    const infs = [...store.inferences.values()]
    expect(infs.find((i) => i.id === aiInference)!.status).toBe("superseded")
    expect(infs.find((i) => i.id === replaced.inferenceId)!.model).toBe(REVIEWED_MODEL)
    // O passo inferido que você não revisou continua lá: não foi visto, não foi recusado.
    expect([...store.nextSteps.values()].some((s) => s.title === "Receber export do ERP")).toBe(true)

    // Reenviar depois da substituição continua sem duplicar.
    await applyReviewedFields(store, input({ nextSteps: [input().nextSteps[0]] }), INTERNAL)
    expect(store.nextSteps.size).toBe(2)
  })

  it("hub depois: não duplica o revisado, e o que só a IA viu vira PROPOSTA, não tarefa", async () => {
    await applyReviewedFields(store, input(), INTERNAL)
    expect(store.nextSteps.size).toBe(2)

    const stats = await runHub(["Enviar a proposta do piloto", "Receber export do ERP"])
    expect(store.nextSteps.size).toBe(2)
    expect(stats.proposed).toContain("next_step:1")
    const proposal = [...store.inferences.values()].find((i) => i.field.startsWith("next_step:") && i.status === "proposed")!
    expect(proposal.value).toMatchObject({ title: "Receber export do ERP" })

    // Versão nova da transcrição: continua sem duplicar.
    await runHub(["Enviar a proposta do piloto", "Receber export do ERP"], "v2")
    expect(store.nextSteps.size).toBe(2)
  })

  it("reunião sem revisão humana segue a política de antes: a IA cria o passo", async () => {
    await runHub(["Receber export do ERP"])
    expect([...store.nextSteps.values()].map((s) => s.title)).toEqual(["Receber export do ERP"])
  })

  it("sinal: o revisado assume a proveniência do inferido, sem segunda linha", async () => {
    await runHub([])
    expect(store.signals.size).toBe(1)
    const r = await applyReviewedFields(store, input({ nextSteps: [], contacts: [] }), INTERNAL)
    expect(r.signals).toEqual([{ type: "asked_price", status: "confirmed" }])
    expect(store.signals.size).toBe(1)
    const sig = store.signals.get(`${ACME}|asked_price`)!
    expect([...store.inferences.values()].find((i) => i.id === sig.inferenceId)!.model).toBe(REVIEWED_MODEL)
    expect(sig.evidence[0]).toMatchObject({ kind: "manual", quote: "Perguntou quanto custa um piloto" })
  })
})

describe("sinais revisados", () => {
  it("captura, reseta o contador na data da reunião e não duplica", async () => {
    const r = await applyReviewedFields(store, input(), INTERNAL)
    expect(r.signals).toEqual([{ type: "asked_price", status: "captured" }])
    expect(r.signals_captured).toBe(1)
    expect(store.companies.get(ACME)!.lastClientEventAt).toBe("2026-10-10T16:00:00.000Z")
    const again = await applyReviewedFields(store, input(), INTERNAL)
    expect(again.signals).toEqual([{ type: "asked_price", status: "existing" }])
  })

  it("sinal capturado à mão (sem inferência) não tem a proveniência trocada", async () => {
    await store.insertSignal({ companyId: ACME, signalType: "asked_price", capturedAt: "2026-10-01", sourceActivityId: "x", inferenceId: null, evidence: [] })
    const r = await applyReviewedFields(store, input(), INTERNAL)
    expect(r.signals[0].status).toBe("existing")
    expect(store.signals.get(`${ACME}|asked_price`)!.inferenceId).toBeNull()
  })

  it("reunião com data no futuro não empurra o contador além de agora", async () => {
    const now = new Date("2026-10-11T00:00:00.000Z")
    await applyReviewedFields(store, input({ meetingDate: "2027-01-01T00:00:00.000Z" }), INTERNAL, () => now)
    expect(store.companies.get(ACME)!.lastClientEventAt).toBe(now.toISOString())
  })
})

describe("contatos revisados", () => {
  it("cria a pessoa na empresa, com cargo, e a põe como participante da atividade", async () => {
    const r = await applyReviewedFields(store, input(), INTERNAL)
    expect(r.contacts_created).toBe(1)
    const p = [...store.people.values()][0]
    expect(p).toMatchObject({ firstName: "João", lastName: "Silva", companyId: ACME })
    expect(r.contacts[0]).toMatchObject({ status: "created", person_id: p.id })
    expect(store.participants.has(`act-1|${p.id}|attendee`)).toBe(true)
  })

  it("liga a quem já existe na empresa pelo nome, sem criar", async () => {
    const joao = store.addPersonRow({ firstName: "João", lastName: "Silva", companyId: ACME })
    const r = await applyReviewedFields(store, input(), INTERNAL)
    expect(r.contacts[0]).toMatchObject({ status: "linked", person_id: joao.id })
    expect(store.people.size).toBe(1)
  })

  it("homônimos na empresa vão para a fila, uma vez só", async () => {
    store.addPersonRow({ firstName: "João", lastName: "Silva", companyId: ACME })
    store.addPersonRow({ firstName: "João", lastName: "S.", companyId: ACME })
    const r = await applyReviewedFields(store, input(), INTERNAL)
    expect(r.contacts[0].status).toBe("review")
    expect(r.contacts_in_review).toBe(1)
    await applyReviewedFields(store, input(), INTERNAL)
    expect(store.people.size).toBe(2)
    const reviews = [...store.reviews.values()]
    expect(reviews).toHaveLength(1)
    expect(reviews[0]).toMatchObject({ reason: "homonimos_na_empresa", companyId: ACME })
    expect(reviews[0].observed).toMatchObject({ name: "João Silva", activity_id: "act-1", meeting_id: MEETING })
  })

  it("e-mail já conhecido vence o nome", async () => {
    const maria = store.addPersonRow({ firstName: "Maria", lastName: "Souza", companyId: ACME })
    await store.addIdentity({ personId: maria.id, kind: "email", valueNorm: "maria@acme.com.br", source: "calendar", confidence: "strong" })
    const r = await applyReviewedFields(store, input({ contacts: [{ name: "M. Souza", email: "Maria@Acme.com.br" }] }), INTERNAL)
    expect(r.contacts[0]).toMatchObject({ status: "linked", person_id: maria.id })
    expect(store.people.size).toBe(1)
  })

  it("e-mail novo grava a identidade, e o próximo envio cai nela", async () => {
    const r = await applyReviewedFields(store, input({ contacts: [{ name: "Ana Lima", email: "ana@acme.com.br" }] }), INTERNAL)
    expect(r.contacts[0].status).toBe("created")
    expect(store.identities.get("email|ana@acme.com.br")!.personId).toBe(r.contacts[0].person_id)
    const again = await applyReviewedFields(store, input({ contacts: [{ name: "Ana Lima", email: "ana@acme.com.br" }] }), INTERNAL)
    expect(again.contacts[0]).toMatchObject({ status: "linked", person_id: r.contacts[0].person_id })
  })

  it("gente da Lumeis (domínio interno) não vira contato do cliente", async () => {
    const r = await applyReviewedFields(store, input({ contacts: [{ name: "Gabriel", email: "gabriel@lumeis.ai" }] }), INTERNAL)
    expect(r.contacts[0].status).toBe("internal")
    expect(store.people.size).toBe(0)
  })
})
