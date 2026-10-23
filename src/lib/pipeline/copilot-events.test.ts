import { describe, it, expect, vi } from "vitest"
import { addDays, format } from "date-fns"
import { recordCopilotEvent } from "./copilot-events"
import { SEEN_SUPPRESS_DAYS } from "@/lib/constants"

describe("SEEN_SUPPRESS_DAYS", () => {
  it("urgente volta amanhã, higiene demora mais", () => {
    expect(SEEN_SUPPRESS_DAYS.meeting_yesterday).toBe(0)
    expect(SEEN_SUPPRESS_DAYS.next_step_overdue).toBe(0)
    const max = Math.max(...Object.values(SEEN_SUPPRESS_DAYS))
    expect(SEEN_SUPPRESS_DAYS.missing_pain_hypothesis).toBe(max)
    expect(SEEN_SUPPRESS_DAYS.stalled_card).toBeLessThan(SEEN_SUPPRESS_DAYS.missing_champion)
  })
})

describe("recordCopilotEvent — seen", () => {
  it("insere seen com campos de resposta nulos e suppress_until = hoje + N", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const supabase = { from: vi.fn(() => ({ insert })) } as never

    await recordCopilotEvent(supabase, {
      workspaceId: "ws",
      userId: "u",
      companyId: "c",
      questionKey: "missing_champion:c",
      ruleId: "missing_champion",
      status: "seen",
      suppressDays: 7,
    })

    expect(insert).toHaveBeenCalledTimes(1)
    const row = insert.mock.calls[0][0]
    expect(row.status).toBe("seen")
    expect(row.action_id).toBeNull()
    expect(row.answer_text).toBeNull()
    expect(row.applied).toBeNull()
    expect(row.suppress_until).toBe(format(addDays(new Date(), 7), "yyyy-MM-dd"))
  })
})
