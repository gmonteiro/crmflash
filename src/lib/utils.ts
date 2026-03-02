import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Validate a redirect path to prevent open redirect attacks.
 * Returns the path if it starts with `/` and is not protocol-relative (`//`),
 * otherwise falls back to `/dashboard`.
 */
export function sanitizeRedirect(value: string | null): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) {
    return value
  }
  return "/dashboard"
}

/**
 * Sanitize a user-provided URL for safe use in href attributes.
 * Only allows http: and https: protocols. Returns undefined for dangerous values
 * (javascript:, data:, vbscript:, etc.) so the link won't render.
 */
/**
 * Verify that a request's Origin header matches the app's own origin.
 * Prevents CSRF on state-changing (POST/PUT/DELETE) cookie-based routes.
 * Returns true if the origin matches, false otherwise.
 */
export function verifyCsrfOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")
  // Browsers always send Origin on POST/PUT/DELETE cross-origin requests.
  // If Origin is absent, fall back to Referer.
  const referer = request.headers.get("referer")
  const source = origin || (referer ? new URL(referer).origin : null)

  if (!source) return false

  // Compare against the app's URL derived from the Host header
  const host = request.headers.get("host")
  if (!host) return false

  const proto = request.headers.get("x-forwarded-proto") || "https"
  const expectedOrigin = `${proto}://${host}`

  return source === expectedOrigin
}

export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  const trimmed = url.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  // Allow protocol-less URLs that look like domains (e.g. "example.com")
  if (/^[a-z0-9][\w.-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`
  return undefined
}
