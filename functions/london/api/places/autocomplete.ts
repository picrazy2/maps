import { Env, guard, json } from "./_shared";

// GET /london/api/places/autocomplete?q=<text>&session=<token>
// Places API (New) autocomplete, restricted to a box around Greater London. The
// session token groups keystrokes with the final details call, so Google bills
// the whole session as one lookup.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const blocked = guard(request, env);
  if (blocked) return blocked;

  const u = new URL(request.url);
  const q = (u.searchParams.get("q") ?? "").trim().slice(0, 100);
  const session = (u.searchParams.get("session") ?? "").slice(0, 64);
  if (q.length < 3) return json({ places: [] });

  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": env.GOOGLE_MAPS_KEY!,
      "X-Goog-FieldMask":
        "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat",
    },
    body: JSON.stringify({
      input: q,
      sessionToken: session || undefined,
      includedRegionCodes: ["gb"],
      locationRestriction: {
        rectangle: {
          low: { latitude: 51.25, longitude: -0.6 },
          high: { latitude: 51.75, longitude: 0.4 },
        },
      },
    }),
  });
  if (!res.ok) {
    const detail = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message;
    console.warn("places", res.status, detail);
    return json({ error: `places ${res.status}`, detail }, 502);
  }

  const data = (await res.json()) as {
    suggestions?: {
      placePrediction?: {
        placeId: string;
        structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } };
      };
    }[];
  };
  const places = (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p) => p?.placeId)
    .map((p) => ({
      id: p!.placeId,
      name: p!.structuredFormat?.mainText?.text ?? "",
      address: p!.structuredFormat?.secondaryText?.text ?? "",
    }));
  return json({ places });
};
