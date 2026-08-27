import { describe, it, expect } from "vitest"
import { moveStage } from "./move-stage"
import { captureSignal } from "./capture-signal"
import { setCompanyContext } from "./set-company-context"

const CO = "11111111-1111-4111-8111-111111111111"

describe("move_stage", () => {
  it("aceita os três alvos e recusa qualquer outro", () => {
    expect(moveStage.input.safeParse({ company_id: CO, target: "next" }).success).toBe(true)
    expect(moveStage.input.safeParse({ company_id: CO, target: "prev" }).success).toBe(true)
    expect(
      moveStage.input.safeParse({ company_id: CO, target: "title", stage_title: "Prova" })
        .success
    ).toBe(true)
    expect(moveStage.input.safeParse({ company_id: CO, target: "pular" }).success).toBe(false)
  })

  it("exige stage_title quando o alvo é title", () => {
    expect(moveStage.input.safeParse({ company_id: CO, target: "title" }).success).toBe(false)
  })
})

describe("capture_signal", () => {
  it("só aceita os seis sinais do enum", () => {
    expect(captureSignal.input.safeParse({ company_id: CO, signal: "asked_price" }).success).toBe(
      true
    )
    expect(
      captureSignal.input.safeParse({ company_id: CO, signal: "gostou_muito" }).success
    ).toBe(false)
  })
})

describe("set_company_context", () => {
  it("exige pelo menos um campo", () => {
    expect(setCompanyContext.input.safeParse({ company_id: CO }).success).toBe(false)
    expect(
      setCompanyContext.input.safeParse({ company_id: CO, champion_name: "Ana" }).success
    ).toBe(true)
  })
})
