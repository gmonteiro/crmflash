import { NextResponse } from "next/server"
import { isCronAuthorized } from "@/lib/auth/cron"
import { SupabaseHubStore } from "@/lib/hub/supabase-store"
import { runDailyReviewAndDigest } from "@/lib/hub/sync"
import { markCronRun } from "@/lib/hub/crons"

export const maxDuration = 300
export const dynamic = "force-dynamic"

// ?company_id=<uuid> revisa só aquela conta (sem e-mail de resumo).
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const store = await SupabaseHubStore.fromEnv()
    const companyId = new URL(request.url).searchParams.get("company_id") ?? undefined
    const result = await runDailyReviewAndDigest(store, { companyId })
    if (!companyId) await markCronRun(store, "daily-review")
    return NextResponse.json(result)
  } catch (e) {
    console.error("[cron/daily-review]", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
