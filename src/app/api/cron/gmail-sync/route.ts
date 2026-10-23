import { NextResponse } from "next/server"
import { isCronAuthorized } from "@/lib/auth/cron"
import { SupabaseHubStore } from "@/lib/hub/supabase-store"
import { runGmailSync } from "@/lib/hub/sync"

export const maxDuration = 300
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const store = await SupabaseHubStore.fromEnv()
    return NextResponse.json(await runGmailSync(store))
  } catch (e) {
    console.error("[cron/gmail-sync]", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
