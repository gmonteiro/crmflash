import { differenceInCalendarDays, parseISO } from "date-fns"
import { STALE_DAYS, FROZEN_DAYS } from "@/lib/constants"

// Saúde de uma conta pelo tempo desde o último evento DO CLIENTE. Estava dentro
// de kanban-card.tsx; virou função pura porque o dashboard passou a mostrar a
// mesma coisa, e "conta parada" é a regra que o copiloto e as métricas também
// usam — três cópias divergindo seria pior que qualquer duplicação de tipo.
export type ClientEventHealth = "fresh" | "stale" | "frozen"

export interface ClientEventStatus {
  /** Dias desde o evento; null quando o cliente nunca fez nada. */
  days: number | null
  health: ClientEventHealth
  /** "hoje", "há 3d" ou "sem evento". */
  label: string
  /** Classe de cor Tailwind, igual no card do kanban e na busca do dashboard. */
  colorClass: string
}

const COLOR: Record<ClientEventHealth, string> = {
  fresh: "text-emerald-600 dark:text-emerald-400",
  stale: "text-amber-600 dark:text-amber-400",
  frozen: "text-red-600 dark:text-red-400",
}

export function clientEventStatus(
  iso: string | null | undefined,
  now: Date = new Date()
): ClientEventStatus {
  // Nunca ter tido evento do cliente é tão ruim quanto ter parado: a conta
  // nunca demonstrou nada. Por isso cai em "frozen", não num estado próprio.
  if (!iso) {
    return { days: null, health: "frozen", label: "sem evento", colorClass: COLOR.frozen }
  }

  const days = differenceInCalendarDays(now, parseISO(iso))
  const health: ClientEventHealth =
    days >= FROZEN_DAYS ? "frozen" : days >= STALE_DAYS ? "stale" : "fresh"

  return {
    days,
    health,
    label: days === 0 ? "hoje" : `há ${days}d`,
    colorClass: COLOR[health],
  }
}
