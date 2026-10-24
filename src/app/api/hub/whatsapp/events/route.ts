import { NextResponse } from "next/server"
import { isCollectorAuthorized } from "@/lib/auth/collector"
import { SupabaseHubStore } from "@/lib/hub/supabase-store"
import { recordDays } from "@/lib/hub/whatsapp-ingest"
import { waEventsBody } from "@/lib/whatsapp/schemas"

export const maxDuration = 60
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  if (!isCollectorAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const parsed = waEventsBody.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 })
  try {
    const store = await SupabaseHubStore.fromEnv()
    const result = await recordDays(store, parsed.data.events)
    // Batimento: o resumo diário avisa se o coletor sumir por mais de 24 h.
    await store.setCursor("whatsapp", new Date().toISOString(), "heartbeat")
    return NextResponse.json(result)
  } catch (e) {
    console.error("[hub/whatsapp/events]", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
