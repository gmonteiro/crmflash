import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { validateIntegrationAuth } from '@/lib/auth/integration'
import { integrationActivitySchema } from '@/lib/validators'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  const userId = validateIntegrationAuth(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rl = rateLimit(rateLimitKey(request, 'integration-activity'), { limit: 30, windowMs: 60_000 })
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const body = await request.json()
  const parsed = integrationActivitySchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const {
    person_id,
    company_id,
    title,
    date,
    source_meeting_id,
    source_app_url,
    transcript,
    summary,
    speakers,
    audio_url,
  } = parsed.data

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Verify ownership: referenced person/company must belong to this user
  if (person_id) {
    const { data: person } = await supabase
      .from('people')
      .select('id')
      .eq('id', person_id)
      .eq('user_id', userId)
      .maybeSingle()

    if (!person) {
      return NextResponse.json({ error: 'Person not found' }, { status: 404 })
    }
  }

  if (company_id) {
    const { data: company } = await supabase
      .from('companies')
      .select('id')
      .eq('id', company_id)
      .eq('user_id', userId)
      .maybeSingle()

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }
  }

  // Dedup check: same meeting + same target = already sent
  if (source_meeting_id) {
    let dedup = supabase
      .from('activities')
      .select('id, created_at')
      .eq('user_id', userId)
      .eq('source', 'transcription_app')
      .eq('source_meeting_id', source_meeting_id)

    if (person_id) {
      dedup = dedup.eq('person_id', person_id)
    } else {
      dedup = dedup.is('person_id', null)
    }
    if (company_id) {
      dedup = dedup.eq('company_id', company_id)
    } else {
      dedup = dedup.is('company_id', null)
    }

    const { data: existing } = await dedup.maybeSingle()

    if (existing) {
      return NextResponse.json({
        activity: existing,
        created: false,
      })
    }
  }

  // Create activity
  const { data: activity, error } = await supabase
    .from('activities')
    .insert({
      user_id: userId,
      person_id: person_id || null,
      company_id: company_id || null,
      type: 'meeting',
      title,
      date: date || new Date().toISOString(),
      source: 'transcription_app',
      source_meeting_id: source_meeting_id || null,
      source_app_url: source_app_url || null,
      transcript: transcript || null,
      summary: summary || null,
      speakers: speakers || null,
      audio_url: audio_url || null,
    })
    .select()
    .single()

  if (error) {
    console.error("Integration activity insert error:", error)
    return NextResponse.json({ error: 'Failed to create activity' }, { status: 500 })
  }

  // Create next steps from action_items if summary provided and company_id exists
  let nextStepsCreated = 0
  if (summary?.action_items?.length > 0 && company_id) {
    const steps = summary.action_items.map((item: string) => ({
      user_id: userId,
      company_id,
      title: item,
    }))

    const { data: created } = await supabase
      .from('company_next_steps')
      .insert(steps)
      .select('id')

    nextStepsCreated = created?.length || 0
  }

  return NextResponse.json({
    activity,
    created: true,
    next_steps_created: nextStepsCreated,
  })
}
