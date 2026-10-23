import { SupabaseHubStore } from "@/lib/hub/supabase-store"
import type { McpIdentity } from "../../identity"

/**
 * As tools que reingerem (sync_now, attach_transcript, link_calendar_event)
 * escrevem pelo mesmo caminho do cron: service role, no workspace do
 * INTEGRATION_USER_ID. Só deixa passar se for o MESMO workspace de quem chamou
 * — senão um membro de outro workspace dispararia escrita num que não é dele.
 */
export async function serviceStoreFor(identity: McpIdentity): Promise<SupabaseHubStore> {
  const store = await SupabaseHubStore.fromEnv()
  if (store.workspaceId !== identity.workspaceId) {
    throw new Error("A ingestão automática está configurada para outro workspace.")
  }
  return store
}
