/**
 * Lightweight in-process rate limiter (token bucket).
 *
 * Serverless caveat: per-instance. In production behind Vercel this means
 * N limiters exist at once — treat the configured ceiling as "per-instance"
 * until swapped for Upstash/Redis. Still kills the common DoS shape (one
 * attacker hammering a single instance) and every abusive client spreads
 * across instances equally.
 */
export interface RateLimitConfig {
  /** Max requests allowed in the window. */
  limit: number
  /** Window size in milliseconds. */
  windowMs: number
}

interface Bucket {
  tokens: number
  lastRefill: number
}

const buckets = new Map<string, Bucket>()

export function rateLimitCheck(key: string, cfg: RateLimitConfig): { ok: boolean; retryAfterMs: number } {
  const now = Date.now()
  const refillPerMs = cfg.limit / cfg.windowMs
  const existing = buckets.get(key)
  const bucket: Bucket = existing ?? { tokens: cfg.limit, lastRefill: now }

  const elapsed = now - bucket.lastRefill
  bucket.tokens = Math.min(cfg.limit, bucket.tokens + elapsed * refillPerMs)
  bucket.lastRefill = now

  if (bucket.tokens < 1) {
    buckets.set(key, bucket)
    const retryAfterMs = Math.ceil((1 - bucket.tokens) / refillPerMs)
    return { ok: false, retryAfterMs }
  }
  bucket.tokens -= 1
  buckets.set(key, bucket)
  return { ok: true, retryAfterMs: 0 }
}

export function principalKey(
  scope: string,
  parts: (string | null | undefined)[],
): string {
  return `${scope}:${parts.filter(Boolean).join(':')}`
}
