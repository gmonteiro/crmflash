import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { validateIntegrationAuth } from '@/lib/auth/integration'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  const userId = validateIntegrationAuth(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rl = rateLimit(rateLimitKey(request, 'integration-check'), { limit: 60, windowMs: 60_000 })
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const meetingId = searchParams.get('meeting_id')

  if (!meetingId) {
    return NextResponse.json({ error: 'meeting_id is required' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data } = await supabase
    .from('activities')
    .select('id, created_at')
    .eq('user_id', userId)
    .eq('source', 'transcription_app')
    .eq('source_meeting_id', meetingId)
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    sent: !!data,
    sent_at: data?.created_at || null,
    activity_id: data?.id || null,
  })
}
