import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createClient } from '@supabase/supabase-js'

/**
 * Valida o segredo compartilhado da integração.
 * Devolve o usuário configurado e o workspace dele, ou null.
 *
 * O TranscriptionApp não muda: continua mandando o mesmo Bearer. O que muda é
 * que o destino agora é um workspace, e o INTEGRATION_USER_ID passa a valer
 * como autoria — quem "registrou" a atividade no CRM.
 *
 * Async porque resolve o workspace no banco. Estas rotas usam service role, e
 * com service role auth.uid() é nulo: current_workspace() não serve aqui.
 */
export async function validateIntegrationAuth(
  request: NextRequest
): Promise<{ userId: string; workspaceId: string } | null> {
  const secret = process.env.INTEGRATION_SECRET
  const userId = process.env.INTEGRATION_USER_ID

  if (!secret || !userId) return null

  const authHeader = request.headers.get('authorization')
  if (!authHeader) return null

  const [scheme, token] = authHeader.split(' ')
  if (scheme !== 'Bearer' || !token) return null

  const tokenBuf = Buffer.from(token)
  const secretBuf = Buffer.from(secret)
  if (tokenBuf.length !== secretBuf.length || !timingSafeEqual(tokenBuf, secretBuf))
    return null

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data: member } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (!member) return null

  return { userId, workspaceId: member.workspace_id }
}
