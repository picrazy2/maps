import { authorised, denied, json } from "./_auth.js";

// Public: the aggregate shown to everyone. It holds no journey times or individual trips.
export async function onRequestGet({ env }) {
  const summary = await env.TFL.get("summary", "json");
  return summary ? json(summary, 200, "public, max-age=60") : json({ error: "no data yet" }, 404);
}

export async function onRequestPut({ request, env }) {
  if (!authorised(request, env)) return denied();
  await env.TFL.put("summary", JSON.stringify(await request.json()));
  return json({ ok: true });
}
