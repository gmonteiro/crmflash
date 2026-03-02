import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { validateIntegrationAuth } from '@/lib/auth/integration'

export async function POST(request: NextRequest) {
  const userId = validateIntegrationAuth(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
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
  } = body

  if (!person_id && !company_id) {
    return NextResponse.json(
      { error: 'At least one of person_id or company_id is required' },
      { status: 400 }
    )
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

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
    return NextResponse.json({ error: error.message }, { status: 500 })
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
