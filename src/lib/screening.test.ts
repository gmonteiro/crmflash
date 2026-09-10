import { describe, it, expect } from "vitest"
import { farthest, afterCutFilter } from "./screening"

describe("farthest", () => {
  it("escolhe o menor created_at", () => {
    const out = farthest([
      { created_at: "2026-08-26T02:59:54+00:00", id: "aaaa" },
      { created_at: "2026-03-01T03:17:19+00:00", id: "bbbb" },
    ])
    expect(out.id).toBe("bbbb")
  })

  it("em empate de created_at, escolhe o maior id", () => {
    const out = farthest([
      { created_at: "2026-03-01T03:17:19+00:00", id: "aaaa" },
      { created_at: "2026-03-01T03:17:19+00:00", id: "cccc" },
      { created_at: "2026-03-01T03:17:19+00:00", id: "bbbb" },
    ])
    expect(out.id).toBe("cccc")
  })

  it("um so elemento devolve ele", () => {
    const only = { created_at: "2026-03-01T03:17:19+00:00", id: "aaaa" }
    expect(farthest([only])).toEqual(only)
  })

  it("lista vazia lanca", () => {
    expect(() => farthest([])).toThrow(/vazia/)
  })
})

describe("afterCutFilter", () => {
  it("monta o or do PostgREST com a chave do corte", () => {
    const out = afterCutFilter({ created_at: "2026-03-01T03:17:19.240507+00:00", id: "3318959c-7956-4b44-8cb7-6029ce8dc73d" })
    expect(out).toBe(
      "created_at.lt.2026-03-01T03:17:19.240507+00:00,and(created_at.eq.2026-03-01T03:17:19.240507+00:00,id.gt.3318959c-7956-4b44-8cb7-6029ce8dc73d)"
    )
  })
})
