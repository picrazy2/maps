export interface Env {
  GOOGLE_MAPS_KEY?: string;
}

// Only our own pages may spend the Places quota.
const ALLOWED = [/(^|\.)akguo\.com$/, /\.pages\.dev$/, /^localhost$/, /^127\.0\.0\.1$/];

export function allowed(request: Request): boolean {
  const src = request.headers.get("origin") ?? request.headers.get("referer");
  if (!src) return false;
  try {
    const host = new URL(src).hostname;
    return ALLOWED.some((re) => re.test(host));
  } catch {
    return false;
  }
}

export function json(body: unknown, status = 200, maxAge = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });
}

export function guard(request: Request, env: Env): Response | null {
  if (!env.GOOGLE_MAPS_KEY) return json({ error: "places search is not configured" }, 503);
  if (!allowed(request)) return json({ error: "forbidden" }, 403);
  return null;
}
