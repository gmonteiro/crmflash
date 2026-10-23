import { z } from "zod"
import { reingestCalendarEvent } from "@/lib/hub/calendar-ingest"
import { ClaudeExtractor } from "@/lib/hub/extraction"
import { runCalendarSync, runTranscriptSync } from "@/lib/hub/sync"
import { ingestMeeting } from "@/lib/hub/transcript-ingest"
import { internalDomains } from "@/lib/identity/normalize"
import { TranscriptionAppClient } from "@/lib/transcription/client"
import type { McpTool } from "../../registry"
import { serviceStoreFor } from "./service-store"

const syncInput = z.object({
  calendar: z.boolean().default(true),
  transcripts: z.boolean().default(true),
})

export const syncNow: McpTool<typeof syncInput> = {
  name: "sync_now",
  description:
    "Roda agora a sincronização que o cron faz: convites do Calendar e reuniões " +
    "transcritas do TranscriptionApp, com extração. Idempotente: rodar de novo não " +
    "duplica nada. Use depois de uma reunião, ou depois de resolver a fila de identidade.",
  input: syncInput,
  async handler(identity, args) {
    const store = await serviceStoreFor(identity)
    const calendar = args.calendar ? await runCalendarSync(store) : null
    const transcripts = args.transcripts ? await runTranscriptSync(store) : null
    return { calendar, transcripts }
  },
}

const attachInput = z.object({
  meeting_id: z.string().uuid().describe("Id da reunião no TranscriptionApp."),
  company_id: z.string().uuid(),
})

export const attachTranscript: McpTool<typeof attachInput> = {
  name: "attach_transcript",
  description:
    "Liga uma reunião do TranscriptionApp a uma empresa e roda a extração (resumo, " +
    "champion, dor, sinais, próximos passos, com evidência). Use quando a reunião não " +
    "tinha convite no Calendar, ou o convite não resolveu a empresa.",
  input: attachInput,
  async handler(identity, args) {
    const store = await serviceStoreFor(identity)
    return ingestMeeting(store, new TranscriptionAppClient(), new ClaudeExtractor(), args.meeting_id, internalDomains(), {
      forceCompanyId: args.company_id,
    })
  },
}

const linkInput = z.object({
  google_event_id: z.string().min(1).describe("O id do evento no Google Calendar."),
  company_id: z.string().uuid(),
})

export const linkCalendarEvent: McpTool<typeof linkInput> = {
  name: "link_calendar_event",
  description:
    "Liga um convite do Calendar a uma empresa quando o domínio dos participantes não " +
    "resolveu sozinho. O convite precisa já ter sido sincronizado (sync_now).",
  input: linkInput,
  async handler(identity, args) {
    const store = await serviceStoreFor(identity)
    const ev = await store.getCalendarEventByGoogleId(args.google_event_id)
    if (!ev) throw new Error("Convite não sincronizado ainda. Rode sync_now e tente de novo.")
    await store.linkCalendarCompany(ev.id, args.company_id, "manual")
    const stats = await reingestCalendarEvent(store, ev, internalDomains())
    return { linked: true, calendar_event: ev.googleEventId, stats }
  },
}
