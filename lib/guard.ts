/**
 * Small protections for a public deployment:
 * - visitors can bring their own API key (sent per request, never stored server-side)
 * - the owner's keys can be locked behind ACCESS_CODE
 * - best-effort in-memory rate limiting per IP (per serverless instance)
 */
const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export type KeyResult = { key: string; own: boolean } | { error: string; status: number };

export function resolveKey(req: Request, header: string, envKey: string | undefined): KeyResult {
  const own = req.headers.get(header)?.trim();
  if (own) return { key: own, own: true };
  if (!envKey) return { error: "No API key configured. Add your own key in Settings.", status: 401 };
  const code = process.env.ACCESS_CODE;
  if (code && req.headers.get("x-access-code") !== code) {
    return { error: "This demo needs an access code, or your own API key in Settings.", status: 403 };
  }
  return { key: envKey, own: false };
}
