import { Env, guard, json } from "./_shared";

// GET /london/api/places/details?id=<placeId>&session=<token>
// Essentials-tier fields only (location, address, viewport): the cheapest SKU, and
// it closes the autocomplete session.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const blocked = guard(request, env);
  if (blocked) return blocked;

  const u = new URL(request.url);
  const id = u.searchParams.get("id") ?? "";
  const session = (u.searchParams.get("session") ?? "").slice(0, 64);
  if (!/^[A-Za-z0-9_-]{10,300}$/.test(id)) return json({ error: "bad id" }, 400);

  const url = new URL(`https://places.googleapis.com/v1/places/${id}`);
  if (session) url.searchParams.set("sessionToken", session);
  const res = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": env.GOOGLE_MAPS_KEY!,
      "X-Goog-FieldMask": "id,formattedAddress,location,viewport",
    },
  });
  if (!res.ok) {
    const detail = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message;
    console.warn("places", res.status, detail);
    return json({ error: `places ${res.status}`, detail }, 502);
  }

  const p = (await res.json()) as {
    id: string;
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
    viewport?: {
      low: { latitude: number; longitude: number };
      high: { latitude: number; longitude: number };
    };
  };
  if (!p.location) return json({ error: "no location" }, 404);
  return json(
    {
      id: p.id,
      address: p.formattedAddress ?? "",
      lng: p.location.longitude,
      lat: p.location.latitude,
      bbox: p.viewport
        ? [p.viewport.low.longitude, p.viewport.low.latitude, p.viewport.high.longitude, p.viewport.high.latitude]
        : null,
    },
    200,
    86400,
  );
};
