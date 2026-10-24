import type { WaCandidate, WaCandidatesResult, WaDayEvent, WaDirectory, WaEventsResult } from "../../../src/lib/whatsapp/contract"
import { aggregateDays, type WaMessage } from "./aggregate"
import { saoPauloDay } from "./day"
import { indexDirectory } from "./directory"
import { matchChat, type ChatInfo } from "./match"

// Um ciclo do coletor. Sem WhatsApp e sem rede aqui dentro: só as interfaces,
// para o teste provar o que sai do PC e o que não sai.
//
//   1. diretório do CRM → índice;
//   2. conversas com atividade nos últimos 30 dias → matcher;
//   3. candidatas novas → POST /candidates (só nome e número);
//   4. vinculadas com mensagem nova → lê desde o começo do dia da última
//      enviada (ou 30 dias, na primeira vez), agrega, POST /events;
//   5. o estado só avança depois do 200.

export interface WaSource {
  listChats(): Promise<(ChatInfo & { id: string; lastActivity: number })[]>
  messagesSince(chatId: string, sinceSeconds: number): Promise<WaMessage[]>
}

export interface CrmApi {
  directory(): Promise<WaDirectory>
  candidates(list: WaCandidate[]): Promise<WaCandidatesResult>
  events(list: WaDayEvent[]): Promise<WaEventsResult>
}

export interface CycleState {
  sent: Record<string, number>
  proposed: string[]
  lastBeatMs: number
}

export const WINDOW_DAYS = 30
export const HEARTBEAT_MS = 60 * 60 * 1000
const BATCH = 50
const DAY_MS = 86_400_000

/** Começo (em segundos) do dia de São Paulo que contém o timestamp. SP é UTC-3 o ano todo desde 2019. */
function startOfSaoPauloDay(tsSeconds: number): number {
  return Date.parse(`${saoPauloDay(tsSeconds)}T03:00:00Z`) / 1000
}

export async function runCycle(
  src: WaSource,
  crm: CrmApi,
  state: CycleState,
  opts: { now: number; internalDigits: Set<string>; chatName?: (c: ChatInfo & { id: string }) => string }
): Promise<{ linked: number; candidates: number; events: number; rejected: number }> {
  const idx = indexDirectory(await crm.directory())
  const windowStart = Math.floor((opts.now - WINDOW_DAYS * DAY_MS) / 1000)
  const chats = (await src.listChats()).filter((c) => c.lastActivity >= windowStart)

  const candidates: { key: string; c: WaCandidate }[] = []
  const pending: WaDayEvent[] = []
  const advance: Record<string, number> = {}
  let linked = 0

  for (const chat of chats) {
    const r = matchChat(chat, idx)
    if (r.status === "ignored") continue
    if (r.status === "candidate") {
      if (!state.proposed.includes(r.chatKey)) candidates.push({ key: r.chatKey, c: r.candidate })
      continue
    }
    linked++
    const last = state.sent[r.chatKey]
    if (last !== undefined && chat.lastActivity <= last) continue
    const since = last === undefined ? windowStart : startOfSaoPauloDay(last)
    const messages = await src.messagesSince(chat.id, since)
    if (!messages.length) continue
    const name = opts.chatName?.(chat) ?? chat.name ?? r.chatKey
    pending.push(...aggregateDays(r.chatKey, r.chat, name, messages, opts.internalDigits))
    advance[r.chatKey] = Math.max(...messages.map((m) => m.timestamp))
  }

  if (candidates.length) {
    await crm.candidates(candidates.map((x) => x.c))
    state.proposed.push(...candidates.map((x) => x.key))
  }

  let rejected = 0
  if (pending.length || opts.now - state.lastBeatMs >= HEARTBEAT_MS) {
    for (let i = 0; i < Math.max(pending.length, 1); i += BATCH) {
      const res = await crm.events(pending.slice(i, i + BATCH))
      rejected += res.rejected.length
    }
    state.lastBeatMs = opts.now
    Object.assign(state.sent, advance)
  }
  return { linked, candidates: candidates.length, events: pending.length, rejected }
}
