import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type Json = Record<string, any>;
function json(data: Json, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function norm(s: any) {
  return String(s ?? "").trim();
}
function upper(s: any) {
  return norm(s).toUpperCase();
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

    const body = await req.json().catch(() => ({}));
    const queryRaw = norm((body as any)?.query); // symbol oder name
    const symbol = upper((body as any)?.symbol);
    const name = norm((body as any)?.name);

    const q = queryRaw || symbol || name;
    if (!q) return json({ error: "Missing query/symbol/name" }, 400);

    const apiKey = (
      Deno.env.get("COINMARKETCAP_API_KEY") ||
      Deno.env.get("CMC_API_KEY") ||
      ""
    ).trim();
    if (!apiKey) return json({ error: "CMC API key not set on server" }, 500);

    // CMC map endpoint
    // -> liefert mehrere Treffer, wir geben Auswahl zurück
    const url =
      "https://pro-api.coinmarketcap.com/v1/cryptocurrency/map?listing_status=active&limit=50&sort=cmc_rank&symbol=" +
      encodeURIComponent(upper(q));

    let res = await fetch(url, {
      headers: { "X-CMC_PRO_API_KEY": apiKey, Accept: "application/json" },
    });

    // Falls symbol-Query nichts liefert, versuchen wir name-Query
    let text = await res.text();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }

    if (!res.ok) return json({ error: "CMC map failed", status: res.status, body: parsed }, 502);

    let data: any[] = Array.isArray(parsed?.data) ? parsed.data : [];
    if (!data.length) {
      const url2 =
        "https://pro-api.coinmarketcap.com/v1/cryptocurrency/map?listing_status=active&limit=50&sort=cmc_rank&name=" +
        encodeURIComponent(q);

      res = await fetch(url2, {
        headers: { "X-CMC_PRO_API_KEY": apiKey, Accept: "application/json" },
      });
      text = await res.text();
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
      if (!res.ok) return json({ error: "CMC map failed", status: res.status, body: parsed }, 502);

      data = Array.isArray(parsed?.data) ? parsed.data : [];
    }

    // Normalisieren und kompaktes Ergebnis liefern
    const items = data.map((x) => ({
      id: x.id,
      symbol: x.symbol,
      name: x.name,
      slug: x.slug,
      rank: x.rank ?? null,
      is_active: x.is_active ?? null,
    }));

    // Heuristik: "beste" Treffer zuerst (symbol exakt + rank niedrig)
    const qSym = upper(q);
    items.sort((a, b) => {
      const aExact = upper(a.symbol) === qSym ? 0 : 1;
      const bExact = upper(b.symbol) === qSym ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const ar = a.rank ?? 999999;
      const br = b.rank ?? 999999;
      return ar - br;
    });

    return json({ ok: true, query: q, matches: items });
  } catch (e) {
    return json({ error: "exception", details: String(e) }, 500);
  }
});
