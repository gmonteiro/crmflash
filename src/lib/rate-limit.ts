/**
 * Simple in-memory sliding-window rate limiter.
 * Sufficient for single-instance / Vercel serverless (warm instances).
 * Swap for Upstash Redis rate limiter for multi-instance production.
 */

interface RateLimitEntry {
  timestamps: number[]
}

const store = new Map<string, RateLimitEntry>()

// Cleanup stale entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000
let lastCleanup = Date.now()

function cleanup(windowMs: number) {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now

  const cutoff = now - windowMs
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff)
    if (entry.timestamps.length === 0) store.delete(key)
  }
}

interface RateLimitOptions {
  /** Max requests within the window */
  limit: number
  /** Time window in milliseconds */
  windowMs: number
}

interface RateLimitResult {
  success: boolean
  remaining: number
  resetMs: number
}

export function rateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const { limit, windowMs } = options
  const now = Date.now()
  const cutoff = now - windowMs

  cleanup(windowMs)

  let entry = store.get(key)
  if (!entry) {
    entry = { timestamps: [] }
    store.set(key, entry)
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff)

  if (entry.timestamps.length >= limit) {
    const oldestInWindow = entry.timestamps[0]
    return {
      success: false,
      remaining: 0,
      resetMs: oldestInWindow + windowMs - now,
    }
  }

  entry.timestamps.push(now)

  return {
    success: true,
    remaining: limit - entry.timestamps.length,
    resetMs: windowMs,
  }
}

/** Build a rate limit key from a request (uses IP + route path) */
export function rateLimitKey(request: Request, prefix: string): string {
  const ip =
    (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    "unknown"
  return `${prefix}:${ip}`
}
