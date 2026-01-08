import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type Json = Record<string, any>;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(data: Json, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function pickArray(j: any): any[] {
  const a = j?.data?.data ?? j?.data?.values ?? j?.data ?? j?.data?.items ?? [];
  return Array.isArray(a) ? a : [];
}

function parseTs(v: any): number {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  const s = String(v ?? "").trim();
  if (!s) return 0;

  const asNum = Number(s);
  if (Number.isFinite(asNum)) return asNum < 1e12 ? asNum * 1000 : asNum;

  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : 0;
}

function parseValue(item: any): number {
  const v = Number(item?.value ?? item?.fear_greed_value ?? item?.score ?? item?.index);
  return Number.isFinite(v) ? v : NaN;
}

function parseClass(item: any): string {
  return String(item?.value_classification ?? item?.classification ?? item?.label ?? "").trim();
}

Deno.serve(async (req) => {
  // ✅ Browser Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
    const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") || "").trim();
    const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();

    // ⚠️ Verhalten wie bisher: Status 200, aber ok:false
    if (!supabaseUrl || !anonKey) {
      return json({ ok: false, error: "Missing env SUPABASE_URL / SUPABASE_ANON_KEY" }, 200);
    }
    if (!serviceKey) {
      return json({ ok: false, error: "Missing env SUPABASE_SERVICE_ROLE_KEY (Functions Secret)" }, 200);
    }

    const authHeader = req.headers.get("Authorization") ?? "";

    // 1) User prüfen (damit wir uid haben)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !authData?.user) {
      return json(
        { ok: false, error: "Not authenticated", details: authErr?.message ?? null },
        200
      );
    }
    const uid = authData.user.id;

    // 2) Admin-Client (bypasst RLS) => CMC Key sicher holen
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: row, error: keyErr } = await admin
      .from("user_api_keys")
      .select("cmc_api_key")
      .eq("user_id", uid)
      .maybeSingle();

    if (keyErr) {
      return json(
        { ok: false, error: "user_api_keys query failed", uid, details: keyErr.message },
        200
      );
    }

    const cmcKey = String(row?.cmc_api_key ?? "").trim();
    if (!cmcKey) {
      return json(
        { ok: false, error: "CMC-API Key fehlt (user_api_keys.cmc_api_key)", uid },
        200
      );
    }

    // 3) Latest
    const latestUrl = `https://pro-api.coinmarketcap.com/v3/fear-and-greed/latest?_t=${Date.now()}`;
    const latestRes = await fetch(latestUrl, {
      headers: {
        Accept: "application/json",
        "X-CMC_PRO_API_KEY": cmcKey,
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });

    if (latestRes.ok) {
      const j = await latestRes.json().catch(() => null);
      const item = j?.data ?? j?.data?.data ?? j?.data?.values ?? null;

      const value = parseValue(item);
      if (Number.isFinite(value)) {
        return json(
          { ok: true, value, classification: parseClass(item), source: "latest" },
          200
        );
      }
    }

    // 4) Fallback: historical
    const histUrl = `https://pro-api.coinmarketcap.com/v3/fear-and-greed/historical?limit=10&_t=${Date.now()}`;
    const histRes = await fetch(histUrl, {
      headers: {
        Accept: "application/json",
        "X-CMC_PRO_API_KEY": cmcKey,
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });

    const text = await histRes.text();
    if (!histRes.ok) {
      return json(
        { ok: false, error: `CMC HTTP ${histRes.status}`, details: text.slice(0, 400) },
        200
      );
    }

    let j: any = null;
    try {
      j = JSON.parse(text);
    } catch {
      return json(
        { ok: false, error: "CMC JSON parse failed", details: text.slice(0, 200) },
        200
      );
    }

    const arr = pickArray(j);
    if (!arr.length) return json({ ok: false, error: "CMC historical empty" }, 200);

    let best = arr[0];
    let bestTs = 0;

    for (const it of arr) {
      const ts =
        parseTs(it?.timestamp) ||
        parseTs(it?.time) ||
        parseTs(it?.update_time) ||
        parseTs(it?.updated_at) ||
        parseTs(it?.date);

      if (ts > bestTs) {
        bestTs = ts;
        best = it;
      }
    }

    const value = parseValue(best);
    if (!Number.isFinite(value)) {
      return json({ ok: false, error: "CMC FGI parse failed", sample: best }, 200);
    }

    return json(
      {
        ok: true,
        value,
        classification: parseClass(best),
        source: "historical_latest_by_ts",
        ts: bestTs || null,
      },
      200
    );
  } catch (e) {
    return json({ ok: false, error: "exception", details: String(e) }, 200);
  }
});
