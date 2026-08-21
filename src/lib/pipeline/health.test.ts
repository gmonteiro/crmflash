import { describe, it, expect } from "vitest"
import { clientEventStatus } from "./health"
import { STALE_DAYS, FROZEN_DAYS } from "@/lib/constants"

const NOW = new Date("2026-08-21T12:00:00Z")
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString()

describe("clientEventStatus", () => {
  it("evento de hoje é fresh e rotula 'hoje'", () => {
    const s = clientEventStatus(daysAgo(0), NOW)
    expect(s).toMatchObject({ days: 0, health: "fresh", label: "hoje" })
  })

  it("nunca ter tido evento conta como frozen", () => {
    const s = clientEventStatus(null, NOW)
    expect(s).toMatchObject({ days: null, health: "frozen", label: "sem evento" })
  })

  it("vira stale exatamente em STALE_DAYS", () => {
    expect(clientEventStatus(daysAgo(STALE_DAYS - 1), NOW).health).toBe("fresh")
    expect(clientEventStatus(daysAgo(STALE_DAYS), NOW).health).toBe("stale")
  })

  it("vira frozen exatamente em FROZEN_DAYS", () => {
    expect(clientEventStatus(daysAgo(FROZEN_DAYS - 1), NOW).health).toBe("stale")
    expect(clientEventStatus(daysAgo(FROZEN_DAYS), NOW).health).toBe("frozen")
  })

  it("rotula os dias decorridos", () => {
    expect(clientEventStatus(daysAgo(3), NOW).label).toBe("há 3d")
  })

  it("cada estado tem sua cor", () => {
    const cores = [0, STALE_DAYS, FROZEN_DAYS].map((d) => clientEventStatus(daysAgo(d), NOW).colorClass)
    expect(new Set(cores).size).toBe(3)
  })
})
