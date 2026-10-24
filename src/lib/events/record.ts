import type { HubStore, UpsertEventResult } from "@/lib/hub/store"
import { classifyEngagement, idempotencyKey } from "./engagement"
import { legacyType, type HubEventInput } from "./types"

/** Sobe quando a lógica de normalização muda; fica gravado em cada evento. */
export const PROCESSOR_VERSION = "hub-1"

export interface RecordedEvent extends UpsertEventResult {
  clientEngaged: boolean
  engagementRule: string
}

/**
 * O único caminho de escrita de evento do hub.
 *
 * 1. decide quem agiu (engagement.ts) e grava a decisão NO evento;
 * 2. upsert pela chave de idempotência: o mesmo fato não vira duas linhas;
 * 3. se o cliente agiu, sobe o contador com a data REAL do fato, com GREATEST.
 *    Reprocessar um fato antigo não rejuvenesce a conta.
 */
export async function recordEvent(store: HubStore, input: HubEventInput): Promise<RecordedEvent> {
  const decision = classifyEngagement(input.kind, input.facts)
  // ISO canônico: o Postgres devolve "+00:00", o Google devolve "Z", e as
  // comparações abaixo (e o GREATEST do banco) precisam do mesmo relógio.
  const occurredAt = new Date(input.occurredAt).toISOString()

  const result = await store.upsertEvent({
    idempotencyKey: idempotencyKey(input.source, input.sourceId, input.kind, input.companyId),
    source: input.source,
    sourceId: input.sourceId,
    sourceVersion: input.sourceVersion ?? null,
    kind: input.kind,
    type: legacyType(input.kind),
    companyId: input.companyId,
    personId: input.personId ?? null,
    occurredAt,
    direction: input.direction,
    clientEngaged: decision.clientEngaged,
    engagementRule: decision.rule,
    title: input.title,
    description: input.description ?? null,
    evidence: input.evidence ?? [],
    sourceMeetingId: input.sourceMeetingId ?? null,
    sourceAppUrl: input.sourceAppUrl ?? null,
    summary: input.summary ?? null,
    transcript: input.transcript ?? null,
    conversationKey: input.conversationKey ?? null,
    processorVersion: PROCESSOR_VERSION,
  })

  if (input.participants?.length) await store.addParticipants(result.id, input.participants)
  // Um fato "no futuro" (relógio torto, data de reunião passada como data do
  // fato) faria a conta parecer viva por semanas. O contador nunca passa de agora.
  if (decision.clientEngaged) {
    const now = new Date().toISOString()
    await store.bumpClientEvent(input.companyId, occurredAt < now ? occurredAt : now)
  }

  return { ...result, clientEngaged: decision.clientEngaged, engagementRule: decision.rule }
}
