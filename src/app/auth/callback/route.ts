import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const redirectTo = searchParams.get('redirect') || '/dashboard'

  if (code) {
    const supabase = await createServerSupabaseClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Initialize default kanban columns for new users
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: existingColumns } = await supabase
          .from('kanban_columns')
          .select('id')
          .eq('user_id', user.id)
          .limit(1)

        if (!existingColumns || existingColumns.length === 0) {
          await supabase.rpc('create_default_kanban_columns', { p_user_id: user.id })
        }
      }

      return NextResponse.redirect(`${origin}${redirectTo}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
