// Bearer-token check for the private TfL endpoints.
export function authorised(request, env) {
  const expected = env.TFL_ADMIN_TOKEN;
  const got = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!expected || got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export const json = (body, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": cache },
  });

export const denied = () => json({ error: "unauthorised" }, 401);
