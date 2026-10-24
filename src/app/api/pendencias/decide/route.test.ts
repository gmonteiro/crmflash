import { beforeEach, describe, expect, it, vi } from "vitest"

const decideInference = vi.fn()
const resolveReview = vi.fn()
let lookup: { data: unknown; error: unknown } = { data: null, error: null }

vi.mock("@/lib/hub/decisions", () => ({
  decideInference: (...a: unknown[]) => decideInference(...a),
  resolveReview: (...a: unknown[]) => resolveReview(...a),
}))
vi.mock("@/lib/utils", () => ({ verifyCsrfOrigin: () => true }))
vi.mock("@/lib/workspace/server", () => ({
  sessionHubStore: async () => ({
    workspaceId: "w",
    userId: "u",
    supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => lookup }) }) }) },
  }),
}))

import { POST } from "./route"

const ID = "11111111-1111-4111-8111-111111111111"
const req = (b: unknown) => new Request("http://x/api/pendencias/decide", { method: "POST", body: JSON.stringify(b) })

describe("POST /api/pendencias/decide — guardas", () => {
  beforeEach(() => {
    decideInference.mockReset()
    resolveReview.mockReset()
  })

  it("erro na leitura da proposta: 500 e não decide", async () => {
    lookup = { data: null, error: { message: "boom" } }
    const res = await POST(req({ type: "inference", id: ID, decision: "accept" }))
    expect(res.status).toBe(500)
    expect(decideInference).not.toHaveBeenCalled()
  })

  it("proposta inexistente: 404 e não decide", async () => {
    lookup = { data: null, error: null }
    const res = await POST(req({ type: "inference", id: ID, decision: "reject" }))
    expect(res.status).toBe(404)
    expect(decideInference).not.toHaveBeenCalled()
  })

  it("aceitar sugestão de estágio: 400 e não decide", async () => {
    lookup = { data: { field: "stage_suggestion" }, error: null }
    const res = await POST(req({ type: "inference", id: ID, decision: "accept" }))
    expect(res.status).toBe(400)
    expect(decideInference).not.toHaveBeenCalled()
  })

  it("caso inexistente: 404 e não resolve", async () => {
    lookup = { data: null, error: null }
    const res = await POST(req({ type: "review", id: ID, resolution: { type: "ignore" } }))
    expect(res.status).toBe(404)
    expect(resolveReview).not.toHaveBeenCalled()
  })

  it("erro na leitura do caso: 500 e não resolve", async () => {
    lookup = { data: null, error: { message: "boom" } }
    const res = await POST(req({ type: "review", id: ID, resolution: { type: "ignore" } }))
    expect(res.status).toBe(500)
    expect(resolveReview).not.toHaveBeenCalled()
  })

  it("caso de reunião: 400 e não resolve", async () => {
    lookup = { data: { observed: { meeting_id: "m" } }, error: null }
    const res = await POST(req({ type: "review", id: ID, resolution: { type: "ignore" } }))
    expect(res.status).toBe(400)
    expect(resolveReview).not.toHaveBeenCalled()
  })
})
