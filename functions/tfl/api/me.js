import { authorised, json } from "./_auth.js";

export async function onRequestGet({ request, env }) {
  return json({ editor: await authorised(request, env) });
}
