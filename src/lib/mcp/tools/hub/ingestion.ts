import { z } from "zod"
import { reingestCalendarEvent } from "@/lib/hub/calendar-ingest"
import { ClaudeExtractor } from "@/lib/hub/extraction"
import { runCalendarSync, runDailyReviewAndDigest, runGmailSync, runTranscriptSync } from "@/lib/hub/sync"
import { ingestMeeting } from "@/lib/hub/transcript-ingest"
import { internalDomains } from "@/lib/identity/normalize"
import { TranscriptionAppClient } from "@/lib/transcription/client"
import type { McpTool } from "../../registry"
import { serviceStoreFor } from "./service-store"

const syncInput = z.object({
  calendar: z.boolean().default(true),
  gmail: z.boolean().default(true),
  transcripts: z.boolean().default(true),
})

export const syncNow: McpTool<typeof syncInput> = {
  name: "sync_now",
  description:
    "Roda agora a sincronização que o cron faz: convites do Calendar, e-mails do Gmail e " +
    "reuniões transcritas do TranscriptionApp, com extração. Idempotente: rodar de novo não " +
    "duplica nada. Use depois de uma reunião, ou depois de resolver a fila de identidade.",
  input: syncInput,
  async handler(identity, args) {
    const store = await serviceStoreFor(identity)
    // As três numa chamada só, dentro dos 300 s da função: cada uma fica com o
    // que sobra. O que não couber continua na próxima (os cursores guardam onde parou).
    const deadline = Date.now() + 260_000
    const left = () => Math.max(10_000, deadline - Date.now())
    const calendar = args.calendar ? await runCalendarSync(store) : null
    // Gmail com erro (escopo ainda não concedido, token velho) não derruba as outras duas.
    const gmail = args.gmail
      ? await runGmailSync(store, Math.min(90_000, left())).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
      : null
    const transcripts = args.transcripts ? await runTranscriptSync(store, left()) : null
    return { calendar, gmail, transcripts }
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

const reviewInput = z.object({
  company_id: z.string().uuid().nullable().default(null).describe("Só esta conta. Sem ela, todas as ativas e o e-mail de resumo."),
})

export const dailyReview: McpTool<typeof reviewInput> = {
  name: "daily_review",
  description:
    "Roda agora a revisão diária: classifica cada conta ativa (Contato a Aprovação) em avanço, " +
    "estagnação ou risco pelo que aconteceu desde a última revisão, citando os eventos, e " +
    "propõe estágio e próximo passo (só proposta; nunca move estágio). Uma vez por dia por " +
    "conta: rodar de novo devolve o veredito já feito. Sem company_id, manda o resumo por e-mail.",
  input: reviewInput,
  async handler(identity, args) {
    const store = await serviceStoreFor(identity)
    return runDailyReviewAndDigest(store, { companyId: args.company_id ?? undefined })
  },
}
