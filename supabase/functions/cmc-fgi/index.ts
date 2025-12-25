import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type Json = Record<string, any>;

function json(data: Json, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function pickArray(j: any): any[] {
  const a =
    j?.data?.data ??
    j?.data?.values ??
    j?.data ??
    j?.data?.items ??
    [];
  return Array.isArray(a) ? a : [];
}

function parseTs(v: any): number {
  // akzeptiert number, ISO string, unix seconds/ms
  if (typeof v === "number" && Number.isFinite(v)) {
    // Heuristik: < 10^12 => seconds
    return v < 1e12 ? v * 1000 : v;
  }
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
  try {
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
    const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") || "").trim();

    if (!supabaseUrl || !anonKey) {
      return json({ error: "Missing env SUPABASE_URL / SUPABASE_ANON_KEY" }, 200);
    }

    const authHeader = req.headers.get("Authorization") ?? "";

    // User-Client (damit RLS passt)
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData?.user) {
      return json({ error: "Not authenticated" }, 200);
    }

    const { data: settings, error: setErr } = await supabase
      .from("user_settings")
      .select("cmc_api_key")
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (setErr) {
      return json({ error: "Settings error", details: setErr.message }, 200);
    }

    const cmcKey = String(settings?.cmc_api_key ?? "").trim();
    if (!cmcKey) {
      return json({ error: "CMC-API Key fehlt (user_settings.cmc_api_key)" }, 200);
    }

    // 1) Latest (sollte exakt dem CMC-Wert entsprechen)
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
      const item =
        j?.data ??
        j?.data?.data ??
        j?.data?.values ??
        null;

      const value = parseValue(item);
      if (Number.isFinite(value)) {
        return json({
          value,
          classification: parseClass(item),
          source: "latest",
        });
      }
      // wenn latest komisch formatiert ist -> fallback
    }

    // 2) Fallback: historical, aber NICHT blind data[0] nehmen
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
        { error: `CMC HTTP ${histRes.status}`, details: text.slice(0, 400) },
        200
      );
    }

    let j: any = null;
    try {
      j = JSON.parse(text);
    } catch {
      return json({ error: "CMC JSON parse failed", details: text.slice(0, 200) }, 200);
    }

    const arr = pickArray(j);
    if (!arr.length) {
      return json({ error: "CMC historical empty" }, 200);
    }

    // nimm den neuesten Eintrag per Timestamp
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
      return json({ error: "CMC FGI parse failed", sample: best }, 200);
    }

    return json({
      value,
      classification: parseClass(best),
      source: "historical_latest_by_ts",
      ts: bestTs || null,
    });
  } catch (e) {
    return json({ error: "exception", details: String(e) }, 200);
  }
});
