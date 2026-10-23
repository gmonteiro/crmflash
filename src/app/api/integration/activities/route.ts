import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { validateIntegrationAuth } from '@/lib/auth/integration'
import { integrationActivitySchema } from '@/lib/validators'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { applyReviewedFromIntegration, findMeetingActivity } from '@/lib/integration/reviewed'

export async function POST(request: NextRequest) {
  const auth = await validateIntegrationAuth(request)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { userId, workspaceId } = auth

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
    next_steps,
    signals,
    contacts,
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
      .eq('workspace_id', workspaceId)
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
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }
  }

  // Dedup: mesma reunião + mesmo destino = já enviada. A atividade não é
  // recriada, mas os campos revisados (abaixo) são processados mesmo assim:
  // reenviar é como você manda o que editou depois.
  let found: Record<string, unknown> | null = null
  let created = false
  if (source_meeting_id) {
    found = await findMeetingActivity(supabase, workspaceId, source_meeting_id, {
      personId: person_id ?? null,
      companyId: company_id ?? null,
    })
  }

  if (!found) {
    const { data: inserted, error } = await supabase
      .from('activities')
      .insert({
        workspace_id: workspaceId,
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
    found = inserted as Record<string, unknown>
    created = true
  }
  const activity = found

  // Formato antigo: summary.action_items (strings) viram próximo passo, só com
  // empresa e só na primeira vez. Com next_steps no payload, eles SUBSTITUEM
  // esta conversão — os mesmos passos chegam nos dois campos, e converter os
  // dois duplicaria.
  let legacyNextSteps = 0
  if (created && !next_steps?.length && summary?.action_items?.length > 0 && company_id) {
    const steps = summary.action_items.map((item: string) => ({
      workspace_id: workspaceId,
      user_id: userId,
      company_id,
      title: item,
    }))

    const { data: createdSteps } = await supabase
      .from('company_next_steps')
      .insert(steps)
      .select('id')

    legacyNextSteps = createdSteps?.length || 0
  }

  // Campos revisados no TranscriptionApp → hub (src/lib/hub/reviewed-fields.ts).
  const hasReviewed = !!(next_steps?.length || signals?.length || contacts?.length)
  let reviewed: Awaited<ReturnType<typeof applyReviewedFromIntegration>> | null = null
  if (hasReviewed && company_id) {
    const activityId = String(activity.id)
    reviewed = await applyReviewedFromIntegration(
      supabase,
      { workspaceId, userId },
      {
        companyId: company_id,
        activityId,
        meetingId: source_meeting_id || `activity:${activityId}`,
        meetingDate: date || (activity.date as string | undefined) || new Date().toISOString(),
        appUrl: source_app_url || null,
        nextSteps: next_steps ?? [],
        signals: signals ?? [],
        contacts: contacts ?? [],
      }
    )
  }

  const r = reviewed?.result
  return NextResponse.json({
    activity,
    created,
    next_steps_created: legacyNextSteps + (r?.next_steps_created ?? 0),
    signals_captured: r?.signals_captured ?? 0,
    contacts_created: r?.contacts_created ?? 0,
    contacts_in_review: r?.contacts_in_review ?? 0,
    // Item a item: o que entrou, o que já estava, o que foi para a fila.
    ...(hasReviewed
      ? {
          structured: company_id
            ? { next_steps: r?.next_steps ?? [], signals: r?.signals ?? [], contacts: r?.contacts ?? [], error: reviewed?.error ?? null }
            : { next_steps: [], signals: [], contacts: [], error: null, skipped: 'sem_empresa' },
        }
      : {}),
  })
}
