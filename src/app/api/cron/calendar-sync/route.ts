import { NextResponse } from "next/server"
import { isCronAuthorized } from "@/lib/auth/cron"
import { SupabaseHubStore } from "@/lib/hub/supabase-store"
import { runCalendarSync } from "@/lib/hub/sync"
import { markCronRun } from "@/lib/hub/crons"

export const maxDuration = 300
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const store = await SupabaseHubStore.fromEnv()
    const result = await runCalendarSync(store)
    await markCronRun(store, "calendar-sync")
    return NextResponse.json(result)
  } catch (e) {
    console.error("[cron/calendar-sync]", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
