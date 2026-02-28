const MIN_GAP = 0.001

export function calculatePosition(
  items: { kanban_position: number | null }[],
  targetIndex: number
): number {
  if (items.length === 0) return 1

  const sorted = items
    .map((item) => item.kanban_position ?? 0)
    .sort((a, b) => a - b)

  if (targetIndex === 0) {
    return sorted[0] - 1
  }

  if (targetIndex >= sorted.length) {
    return sorted[sorted.length - 1] + 1
  }

  const before = sorted[targetIndex - 1]
  const after = sorted[targetIndex]
  const mid = (before + after) / 2

  if (after - before < MIN_GAP) {
    // Needs rebalancing, but for now just return a valid value
    return before + (after - before) / 2
  }

  return mid
}

export function needsRebalancing(positions: number[]): boolean {
  if (positions.length < 2) return false
  const sorted = [...positions].sort((a, b) => a - b)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] < MIN_GAP) return true
  }
  return false
}

export function rebalancePositions(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1)
}
