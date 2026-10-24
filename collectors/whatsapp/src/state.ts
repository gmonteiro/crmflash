import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import type { CycleState } from "./cycle"

export function loadState(path: string): CycleState {
  if (!existsSync(path)) return { sent: {}, proposed: [], lastBeatMs: 0 }
  const s = JSON.parse(readFileSync(path, "utf8")) as Partial<CycleState>
  return { sent: s.sent ?? {}, proposed: s.proposed ?? [], lastBeatMs: s.lastBeatMs ?? 0 }
}

/** Grava num temporário e renomeia: PC desligado no meio não corrompe o estado. */
export function saveState(path: string, s: CycleState): void {
  writeFileSync(`${path}.tmp`, JSON.stringify(s, null, 2))
  renameSync(`${path}.tmp`, path)
}
