import type { TranscriptionSource } from "@/lib/transcription/client"
import type { Extractor } from "./extraction"
import type { HubStore } from "./store"
import { ingestMeeting, TRANSCRIPT_BACKFILL_DAYS, type TranscriptIngestResult } from "./transcript-ingest"

// Projeto do TranscriptionApp → empresa do CRM. O projeto é escolhido por
// você no app, então vale como vínculo explícito: toda reunião dele desce para
// a empresa ligada, com ou sem convite. A ligação nasce na fila
// (projeto_sem_empresa) e fica em tapp_project_companies (022).

/**
 * Liga o projeto e reprocessa as reuniões dele da janela de backfill. Sem a
 * segunda parte, as reuniões que abriram o caso ficariam para trás: o cursor do
 * sync já passou delas. Reprocessar é idempotente.
 */
export async function linkProjectAndReingest(
  store: HubStore,
  source: TranscriptionSource,
  extractor: Extractor,
  internal: Set<string>,
  project: { id: string; name: string | null },
  target: { companyId: string } | { ignored: true },
  now: number = Date.now()
): Promise<TranscriptIngestResult[]> {
  const ignored = "ignored" in target
  await store.linkTappProject(project.id, project.name, ignored ? null : target.companyId, ignored)

  const since = new Date(now - TRANSCRIPT_BACKFILL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const mine = (await source.listUpdated(since)).filter((m) => m.project?.id === project.id)
  const out: TranscriptIngestResult[] = []
  // Ignorado: as reuniões voltam para o caminho do convite, que pode ligá-las.
  for (const m of mine) out.push(await ingestMeeting(store, source, extractor, m.id, internal))
  return out
}
