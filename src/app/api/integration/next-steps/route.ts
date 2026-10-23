import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { validateIntegrationAuth } from '@/lib/auth/integration'
import { integrationNextStepsSchema } from '@/lib/validators'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { applyReviewedFromIntegration, findMeetingActivity } from '@/lib/integration/reviewed'

/**
 * Manda uma pendência depois que a reunião já foi enviada (ex.: da página do
 * projeto no TranscriptionApp). Mesmo caminho e mesma chave do envio da
 * reunião: tapp:<reunião>:h:<pendência>, então mandar por aqui e depois
 * reenviar a reunião (ou o contrário) não duplica.
 *
 * Exige que a reunião já tenha ido para esta empresa: o passo precisa de uma
 * atividade de origem, para a proveniência apontar para a reunião certa.
 */
export async function POST(request: NextRequest) {
  const auth = await validateIntegrationAuth(request)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { userId, workspaceId } = auth

  const rl = rateLimit(rateLimitKey(request, 'integration-next-steps'), { limit: 30, windowMs: 60_000 })
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const body = await request.json().catch(() => null)
  const parsed = integrationNextStepsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }
  const { company_id, source_meeting_id, next_steps } = parsed.data

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const activity = await findMeetingActivity(supabase, workspaceId, source_meeting_id, {
    personId: null,
    companyId: company_id,
  })
  if (!activity) {
    return NextResponse.json(
      { error: 'Meeting not sent to this company yet', code: 'meeting_not_sent' },
      { status: 404 }
    )
  }

  const { result, error } = await applyReviewedFromIntegration(
    supabase,
    { workspaceId, userId },
    {
      companyId: company_id,
      activityId: activity.id,
      meetingId: source_meeting_id,
      meetingDate: activity.date ?? activity.created_at,
      appUrl: null,
      nextSteps: next_steps,
      signals: [],
      contacts: [],
    }
  )
  if (!result) {
    return NextResponse.json({ error: 'Failed to apply next steps', detail: error }, { status: 500 })
  }

  return NextResponse.json({
    activity_id: activity.id,
    next_steps_created: result.next_steps_created,
    next_steps: result.next_steps,
  })
}
