import type { HubStore } from "./store"

// Os crons da Vercel. A aba Sistema alerta se algum ficar mais de 26 h sem rodar.
export const CRON_NAMES = ["calendar-sync", "gmail-sync", "transcripts-sync", "daily-review"] as const
export type CronName = (typeof CRON_NAMES)[number]

// Grava que o cron terminou sem erro. Só no caminho de sucesso da rota.
export async function markCronRun(store: HubStore, name: CronName): Promise<void> {
  await store.setCursor("cron", new Date().toISOString(), name)
}
