import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type Json = Record<string, any>;

function json(data: Json, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function upperSymbols(input: any): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((s) => String(s ?? "").trim().toUpperCase())
    .filter((s) => s.length > 0);
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

    const body = await req.json().catch(() => ({}));
    const symbols = upperSymbols((body as any)?.symbols);

    if (!symbols.length) {
      return json({ error: "symbols missing", hint: 'POST body: {"symbols":["BTC","ETH"]}' }, 400);
    }

    const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
    const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
    const INTERNAL_FN_SECRET = (Deno.env.get("INTERNAL_FN_SECRET") || "").trim();

    if (!supabaseUrl || !serviceKey) {
      return json({ error: "Missing env", details: { hasSupabaseUrl: !!supabaseUrl, hasServiceKey: !!serviceKey } }, 500);
    }

    // ✅ akzeptiere beide Secret-Namen für CMC Key
    const CMC_API_KEY_ENV = (
      Deno.env.get("COINMARKETCAP_API_KEY") ||
      Deno.env.get("CMC_API_KEY") ||
      ""
    ).trim();

    // === INTERNAL AUTH (2 Wege) ===
    // 1) x-internal-secret matcht
    const internalHeader = (req.headers.get("x-internal-secret") || "").trim();
    const internalByHeader = !!INTERNAL_FN_SECRET && internalHeader === INTERNAL_FN_SECRET;

    // 2) Authorization: Bearer <SERVICE_ROLE_KEY> (für interne Edge-Calls)
    const authHeader = (req.headers.get("Authorization") || "").trim();
    const internalByServiceKey = authHeader === `Bearer ${serviceKey}` || authHeader === `Bearer ${serviceKey}`; // tolerant

    const isInternal = internalByHeader || internalByServiceKey;

    let cmcApiKey: string | null = null;

    if (isInternal) {
      if (!CMC_API_KEY_ENV) {
        return json(
          {
            error: "CMC API key secret not set",
            hint: "Set Edge Function secret COINMARKETCAP_API_KEY (preferred) or CMC_API_KEY.",
          },
          500
        );
      }
      cmcApiKey = CMC_API_KEY_ENV;
    } else {
      // USER FLOW: braucht echten JWT
      if (!authHeader.startsWith("Bearer ")) {
        return json(
          {
            error: "Missing authorization header",
            hint: "Use Authorization: Bearer <jwt> for user calls, or internal auth for server calls.",
          },
          401
        );
      }

      const jwt = authHeader.replace("Bearer ", "");
      const admin = createClient(supabaseUrl, serviceKey);

      const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
      if (userErr || !userRes?.user?.id) {
        return json({ error: "Invalid JWT", details: userErr?.message ?? null }, 401);
      }

      const uid = userRes.user.id;

      const { data: settings, error: setErr } = await admin
        .from("user_settings")
        .select("cmc_api_key")
        .eq("user_id", uid)
        .maybeSingle();

      if (setErr) return json({ error: "user_settings query failed", details: setErr.message }, 500);

      const k = String((settings as any)?.cmc_api_key ?? "").trim();
      if (!k) return json({ error: "CMC key not set for user" }, 400);

      cmcApiKey = k;
    }

    const url =
      "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=" +
      encodeURIComponent(symbols.join(","));

    const res = await fetch(url, {
      headers: {
        "X-CMC_PRO_API_KEY": cmcApiKey!,
        Accept: "application/json",
      },
    });

    const text = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }

    if (!res.ok) {
      return json({ error: "CMC request failed", status: res.status, body: parsed }, 502);
    }

    const prices: Record<string, number> = {};
    for (const sym of symbols) {
      const p = parsed?.data?.[sym]?.quote?.USD?.price;
      if (typeof p === "number" && Number.isFinite(p)) prices[sym] = p;
    }

    return json(prices);
  } catch (e) {
    return json({ error: "exception", details: String(e) }, 500);
  }
});
