import { NextResponse } from "next/server"
import { isCronAuthorized } from "@/lib/auth/cron"
import { SupabaseHubStore } from "@/lib/hub/supabase-store"
import { runTranscriptSync } from "@/lib/hub/sync"

// Extração de uma reunião longa leva dezenas de segundos; várias numa rodada,
// alguns minutos.
export const maxDuration = 300
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const store = await SupabaseHubStore.fromEnv()
    const result = await runTranscriptSync(store)
    return NextResponse.json(result, { status: result.failed.length ? 207 : 200 })
  } catch (e) {
    console.error("[cron/transcripts-sync]", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
