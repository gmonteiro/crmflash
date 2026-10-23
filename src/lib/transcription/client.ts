// Cliente da API de serviço do TranscriptionApp (PR gmonteiro/TranscriptionApp#6).
// Só leitura: o TranscriptionApp é dono da transcrição; o CRM só lê.

export interface TappMeetingSummary {
  id: string
  title: string
  status: string
  started_at: string | null
  ended_at: string | null
  updated_at: string
  google_calendar_event_id: string | null
  language: string
  transcript_version: string
  /** Gravação do desktop ou importada vem sem started_at; created_at vem sempre. */
  created_at?: string | null
  /** Projeto escolhido no TranscriptionApp; o CRM liga cada um a uma empresa (022). */
  project?: { id: string; name: string | null } | null
}

export interface TappBundle extends TappMeetingSummary {
  app_url: string
  transcript: string
  transcript_source: "full_transcript" | "segments" | "none"
  segments: { index: number; text: string; start_seconds: number | null; duration_seconds: number | null; speaker_id: string | null }[]
  speakers: { id: string; index: number; label: string; name: string | null; email: string | null; raw_name: string | null }[]
  utterances: { speaker_id: string; index: number; text: string }[]
}

export interface TranscriptionSource {
  /** Todas as páginas desde `updatedSince`. Devolve o maior updated_at visto. */
  listUpdated(updatedSince: string | null): Promise<TappMeetingSummary[]>
  getBundle(meetingId: string): Promise<TappBundle | null>
}

export class TranscriptionAppClient implements TranscriptionSource {
  constructor(
    private readonly baseUrl = process.env.TRANSCRIPTIONAPP_API_URL ?? "",
    private readonly token = process.env.TRANSCRIPTIONAPP_SERVICE_TOKEN ?? ""
  ) {
    if (!baseUrl || !token) throw new Error("TRANSCRIPTIONAPP_API_URL e TRANSCRIPTIONAPP_SERVICE_TOKEN são obrigatórias")
    // O apex devolve 307 e o POST perde o corpo; GET sobrevive, mas o www é o certo.
    this.baseUrl = baseUrl.replace(/\/+$/, "")
  }

  private async get<T>(path: string): Promise<T | null> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: { Authorization: `Bearer ${this.token}` } })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`TranscriptionApp ${res.status} em ${path}: ${await res.text()}`)
    return (await res.json()) as T
  }

  async listUpdated(updatedSince: string | null): Promise<TappMeetingSummary[]> {
    const out: TappMeetingSummary[] = []
    let cursor: string | null = null
    // A página pode vir vazia e ainda ter next_cursor: segue até null.
    for (let guard = 0; guard < 200; guard++) {
      const params = new URLSearchParams({ limit: "100" })
      if (updatedSince) params.set("updated_since", updatedSince)
      if (cursor) params.set("cursor", cursor)
      const page = await this.get<{ meetings: TappMeetingSummary[]; next_cursor: string | null }>(
        `/api/integration/meetings?${params}`
      )
      out.push(...(page?.meetings ?? []))
      cursor = page?.next_cursor ?? null
      if (!cursor) break
    }
    return out
  }

  getBundle(meetingId: string) {
    return this.get<TappBundle>(`/api/integration/meetings/${encodeURIComponent(meetingId)}`)
  }
}
