import type { WaCandidate, WaCandidatesResult, WaDayEvent, WaDirectory, WaEventsResult } from "../../../src/lib/whatsapp/contract"
import type { CrmApi } from "./cycle"

export function crmClient(baseUrl: string, token: string): CrmApi {
  const base = baseUrl.replace(/\/$/, "")
  async function call<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base}/api/hub/whatsapp/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`CRM ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`)
    return (await res.json()) as T
  }
  return {
    directory: () => call<WaDirectory>("directory"),
    candidates: (list: WaCandidate[]) => call<WaCandidatesResult>("candidates", { candidates: list }),
    events: (list: WaDayEvent[]) => call<WaEventsResult>("events", { events: list }),
  }
}
