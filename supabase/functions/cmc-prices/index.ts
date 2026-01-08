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
  const startedAt = Date.now();
  try {
    console.log("cmc-prices hit", {
      at: new Date().toISOString(),
      method: req.method,
      hasAuth: !!req.headers.get("Authorization"),
      hasInternal: !!req.headers.get("x-internal-secret"),
    });

    if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

    const body = await req.json().catch(() => ({}));
    const symbols = upperSymbols((body as any)?.symbols);

    console.log("cmc-prices input", {
      symbolsCount: symbols.length,
      symbols,
    });

    if (!symbols.length) {
      return json({ error: "symbols missing", hint: 'POST body: {"symbols":["BTC","ETH"]}' }, 400);
    }

    const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
    const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
    const INTERNAL_FN_SECRET = (Deno.env.get("INTERNAL_FN_SECRET") || "").trim();

    if (!supabaseUrl || !serviceKey) {
      return json(
        {
          error: "Missing env",
          details: { hasSupabaseUrl: !!supabaseUrl, hasServiceKey: !!serviceKey },
        },
        500
      );
    }

    // Globaler Key (optional – nur für internen Server-Call)
    const CMC_API_KEY_ENV = (
      Deno.env.get("COINMARKETCAP_API_KEY") ||
      Deno.env.get("CMC_API_KEY") ||
      ""
    ).trim();

    // === INTERNAL AUTH (für check-entry-alerts etc.) ===
    const internalHeader = (req.headers.get("x-internal-secret") || "").trim();
    const isInternal = !!INTERNAL_FN_SECRET && internalHeader === INTERNAL_FN_SECRET;

    const authHeader = (req.headers.get("Authorization") || "").trim();
    let cmcApiKey: string | null = null;

    const admin = createClient(supabaseUrl, serviceKey);

    if (isInternal) {
      console.log("cmc-prices mode", { mode: "internal" });

      // interner Call nutzt globalen Key
      if (!CMC_API_KEY_ENV) {
        console.error("cmc-prices internal missing global CMC key");
        return json(
          {
            error: "CMC API key secret not set",
            hint: "Set Supabase secret COINMARKETCAP_API_KEY (preferred) or CMC_API_KEY.",
          },
          500
        );
      }
      cmcApiKey = CMC_API_KEY_ENV;
    } else {
      console.log("cmc-prices mode", { mode: "user" });

      // User-Call braucht JWT
      if (!authHeader.startsWith("Bearer ")) {
        return json(
          {
            error: "Missing authorization header",
            hint: "Use Authorization: Bearer <jwt> for user calls.",
          },
          401
        );
      }

      const jwt = authHeader.replace("Bearer ", "");
      const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
      if (userErr || !userRes?.user?.id) {
        return json({ error: "Invalid JWT", details: userErr?.message ?? null }, 401);
      }

      const uid = userRes.user.id;
      console.log("cmc-prices user", { uid });

      // Key aus user_api_keys holen
      const { data: keyRow, error: keyErr } = await admin
        .from("user_api_keys")
        .select("cmc_api_key")
        .eq("user_id", uid)
        .maybeSingle();

      if (keyErr) return json({ error: "user_api_keys query failed", details: keyErr.message }, 500);

      let k = String((keyRow as any)?.cmc_api_key ?? "").trim();

      // optionaler Fallback falls du später user_settings nutzt
      if (!k) {
        const { data: settings, error: setErr } = await admin
          .from("user_settings")
          .select("cmc_api_key")
          .eq("user_id", uid)
          .maybeSingle();

        if (setErr) return json({ error: "user_settings query failed", details: setErr.message }, 500);
        k = String((settings as any)?.cmc_api_key ?? "").trim();
      }

      if (!k) return json({ error: "CMC key not set for user" }, 400);

      cmcApiKey = k;
    }

    const url =
      "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=" +
      encodeURIComponent(symbols.join(","));

    console.log("cmc-prices request", {
      url,
      symbolsCount: symbols.length,
    });

    const res = await fetch(url, {
      headers: {
        "X-CMC_PRO_API_KEY": cmcApiKey!,
        Accept: "application/json",
      },
    });

    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }

    console.log("cmc-prices CMC status", {
      ok: res.ok,
      status: res.status,
      tookMs: Date.now() - startedAt,
      cmcStatusError: parsed?.status?.error_message ?? null,
      cmcStatusCode: parsed?.status?.error_code ?? null,
    });

    if (!res.ok) {
      return json({ error: "CMC request failed", status: res.status, body: parsed }, 502);
    }

    const prices: Record<string, number> = {};
    const missing: string[] = [];

    for (const sym of symbols) {
      const p = parsed?.data?.[sym]?.quote?.USD?.price;
      if (typeof p === "number" && Number.isFinite(p)) {
        prices[sym] = p;
      } else {
        missing.push(sym);
      }
    }

    console.log("cmc-prices output", {
      got: Object.keys(prices).length,
      missingCount: missing.length,
      missing: missing.slice(0, 50),
      sample: Object.entries(prices).slice(0, 10),
    });

    // Response bleibt absichtlich NUR das Mapping, damit check-entry-alerts nicht kaputt geht
    return json(prices);
  } catch (e) {
    console.error("cmc-prices exception", String(e));
    return json({ error: "exception", details: String(e) }, 500);
  }
});
