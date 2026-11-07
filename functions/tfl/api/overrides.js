import { authorised, denied, json } from "./_auth.js";

export async function onRequestPut({ request, env }) {
  if (!(await authorised(request, env))) return denied();
  const overrides = await request.json();
  if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) return json({ error: "expected an object" }, 400);
  await env.TFL.put("overrides", JSON.stringify(overrides));
  return json({ ok: true });
}
