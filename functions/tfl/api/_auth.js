// Who may change TfL data: the upload script's bearer token, or a Google account signed in through
// the same Supabase project as flightlog, whose email is listed in TFL_EDITOR_EMAILS.
const sameToken = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export async function authorised(request, env) {
  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  if (sameToken(token, env.TFL_ADMIN_TOKEN)) return true;
  const allowed = (env.TFL_EDITOR_EMAILS ?? "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.length) return false;
  const res = await fetch(`${env.TFL_SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.TFL_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return false;
  const user = await res.json();
  return allowed.includes(String(user.email ?? "").toLowerCase());
}

export const json = (body, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": cache },
  });

export const denied = () => json({ error: "unauthorised" }, 401);
