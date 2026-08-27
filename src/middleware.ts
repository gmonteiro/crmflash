import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// "Público" aqui significa "não autentica por cookie de sessão" — não que seja
// aberto. /api/integration valida segredo compartilhado e /api/mcp valida Bearer
// na própria rota; deixar o middleware barrá-los faria o handler nunca rodar.
// "Público" aqui significa "não autentica por cookie de sessão" — não que seja
// aberto. /api/integration valida segredo compartilhado, /api/mcp valida Bearer
// e as rotas de OAuth validam o próprio protocolo; deixar o middleware barrá-las
// faria o handler nunca rodar.
//
// /oauth/authorize fica DE FORA de propósito: ela precisa da sessão, e o
// redirect para /login é justamente o comportamento desejado.
const publicRoutes = [
  '/login',
  '/signup',
  '/auth/callback',
  '/api/integration',
  '/api/mcp',
  '/.well-known/',
  '/api/oauth/',
]

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  if (!user && !publicRoutes.some((route) => pathname.startsWith(route))) {
    // Return 401 JSON for API routes instead of redirecting to login
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // O destino leva a query junto: o fluxo OAuth passa client_id, state e
    // code_challenge por aí, e mandar só o pathname faria a tela de
    // consentimento voltar do login sem saber o que estava sendo autorizado.
    const target = pathname + request.nextUrl.search

    const url = request.nextUrl.clone()
    url.pathname = '/login'
    // O clone traz os params da rota original; sem limpar, eles vazariam soltos
    // na URL do login ao lado do redirect.
    url.search = ''
    url.searchParams.set('redirect', target)
    return NextResponse.redirect(url)
  }

  if (user && (pathname.startsWith('/login') || pathname.startsWith('/signup'))) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
