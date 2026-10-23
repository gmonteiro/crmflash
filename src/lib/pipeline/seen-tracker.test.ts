import { describe, it, expect } from "vitest"
import { createSeenTracker } from "./seen-tracker"

describe("createSeenTracker", () => {
  it("trocar antes do dwell mínimo não conta como visto", () => {
    const t = createSeenTracker(3000)
    expect(t.focus("a", 0)).toBeNull()
    expect(t.focus("b", 2999)).toBeNull()
  })

  it("trocar depois do dwell devolve a conta que saiu", () => {
    const t = createSeenTracker(3000)
    t.focus("a", 0)
    expect(t.focus("b", 3000)).toBe("a")
  })

  it("a mesma conta só é devolvida uma vez", () => {
    const t = createSeenTracker(3000)
    t.focus("a", 0)
    expect(t.focus("b", 5000)).toBe("a")
    t.focus("a", 6000)
    expect(t.focus("b", 20000)).toBeNull()
  })

  it("refocar a mesma conta não devolve nada nem reinicia o relógio", () => {
    const t = createSeenTracker(3000)
    t.focus("a", 0)
    expect(t.focus("a", 1000)).toBeNull()
    expect(t.focus("b", 3000)).toBe("a")
  })

  it("focus(null) zera sem devolver", () => {
    const t = createSeenTracker(3000)
    t.focus("a", 0)
    expect(t.focus(null, 10000)).toBeNull()
    expect(t.focus("b", 10001)).toBeNull()
  })

  it("conta marcada com skip nunca é devolvida", () => {
    const t = createSeenTracker(3000)
    t.focus("a", 0)
    t.skip("a")
    expect(t.focus("b", 9000)).toBeNull()
  })
})
