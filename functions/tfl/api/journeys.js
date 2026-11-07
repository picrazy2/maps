import { authorised, denied, json } from "./_auth.js";

// Journeys and route overrides are public to read. Changing them needs authorised().
export async function onRequestGet({ env }) {
  const [journeys, overrides] = await Promise.all([env.TFL.get("journeys", "json"), env.TFL.get("overrides", "json")]);
  return json({ journeys: journeys ?? [], overrides: overrides ?? {} });
}

// Merges by id. TfL only keeps eight weeks, so older journeys must survive each upload.
export async function onRequestPost({ request, env }) {
  if (!(await authorised(request, env))) return denied();
  const incoming = await request.json();
  if (!Array.isArray(incoming)) return json({ error: "expected an array of journeys" }, 400);
  const byId = new Map(((await env.TFL.get("journeys", "json")) ?? []).map((j) => [j.id, j]));
  const before = byId.size;
  for (const j of incoming) {
    if (typeof j?.id === "string") byId.set(j.id, j);
  }
  const merged = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  await env.TFL.put("journeys", JSON.stringify(merged));
  return json({ total: merged.length, added: merged.length - before });
}
