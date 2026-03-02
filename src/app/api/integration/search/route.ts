import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { validateIntegrationAuth } from '@/lib/auth/integration'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  const userId = validateIntegrationAuth(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rl = rateLimit(rateLimitKey(request, 'integration-search'), { limit: 60, windowMs: 60_000 })
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim()
  const type = searchParams.get('type') || 'all'

  if (!q) {
    return NextResponse.json({ people: [], companies: [] })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const pattern = `%${q}%`
  const result: { people: unknown[]; companies: unknown[] } = { people: [], companies: [] }

  if (type === 'all' || type === 'people') {
    const { data } = await supabase
      .from('people')
      .select('id, full_name, current_title, current_company')
      .eq('user_id', userId)
      .ilike('full_name', pattern)
      .limit(20)

    result.people = data || []
  }

  if (type === 'all' || type === 'companies') {
    const { data } = await supabase
      .from('companies')
      .select('id, name, industry')
      .eq('user_id', userId)
      .ilike('name', pattern)
      .limit(20)

    result.companies = data || []
  }

  return NextResponse.json(result)
}
