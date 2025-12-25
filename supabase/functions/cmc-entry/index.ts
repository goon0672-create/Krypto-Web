import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function isoWeekKey(d: Date) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function sma(values: number[], period: number) {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

function atr14FromOHLC(highs: number[], lows: number[], closes: number[], period = 14) {
  if (highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) return null;

  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const h = highs[i];
    const l = lows[i];
    const prevClose = closes[i - 1];
    const tr = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
    trs.push(tr);
  }
  if (trs.length < period) return null;

  // simple ATR: average of last period TRs
  let sum = 0;
  for (let i = trs.length - period; i < trs.length; i++) sum += trs[i];
  return sum / period;
}

function fib618(high: number, low: number) {
  return high - (high - low) * 0.618;
}
function fib786(high: number, low: number) {
  return high - (high - low) * 0.786;
}

async function fetchMexcKlines(baseSymbol: string, limit: number) {
  const mexcSymbol = `${baseSymbol.toUpperCase()}USDT`;
  const url = `https://api.mexc.com/api/v3/klines?symbol=${encodeURIComponent(mexcSymbol)}&interval=1d&limit=${limit}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`MEXC klines HTTP ${res.status}: ${text}`);

  const arr = JSON.parse(text);
  if (!Array.isArray(arr) || arr.length === 0) throw new Error(`MEXC returned no candles for ${mexcSymbol}`);

  // [openTime, open, high, low, close, volume, closeTime, ...]
  const highs: number[] = [];
  const lows: number[] = [];
  const closes: number[] = [];

  for (const k of arr) {
    const h = Number(k?.[2]);
    const l = Number(k?.[3]);
    const c = Number(k?.[4]);
    if (Number.isFinite(h) && Number.isFinite(l) && Number.isFinite(c)) {
      highs.push(h);
      lows.push(l);
      closes.push(c);
    }
  }

  if (closes.length < Math.min(60, limit)) {
    throw new Error(`Not enough candles for ${mexcSymbol}. got=${closes.length}`);
  }

  return { mexcSymbol, highs, lows, closes };
}

async function fetchMexcLastPrice(baseSymbol: string) {
  const mexcSymbol = `${baseSymbol.toUpperCase()}USDT`;
  const url = `https://api.mexc.com/api/v3/ticker/price?symbol=${encodeURIComponent(mexcSymbol)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const txt = await res.text();
  if (!res.ok) throw new Error(`MEXC ticker HTTP ${res.status}: ${txt}`);
  const j = JSON.parse(txt);
  const p = Number(j?.price);
  if (!Number.isFinite(p) || p <= 0) throw new Error(`Invalid MEXC ticker price: ${txt}`);
  return { mexcSymbol, lastPrice: p };
}

serve(async (req) => {
  try {
    console.log("cmc-entry (3 entries / MEXC) called");

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing auth Bearer token" }), { status: 401 });
    }
    const jwt = authHeader.replace("Bearer ", "");

    const body = await req.json().catch(() => ({}));
    const symbol = String(body.symbol ?? "").trim().toUpperCase();
    const lookbackDays = Number(body.lookbackDays ?? 90);
    const force = body.force === true;

    if (!symbol) return new Response(JSON.stringify({ error: "symbol missing" }), { status: 400 });
    if (!Number.isFinite(lookbackDays) || lookbackDays < 60 || lookbackDays > 365) {
      return new Response(JSON.stringify({ error: "invalid lookbackDays (60..365)" }), { status: 400 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "Supabase env missing" }), { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userRes?.user?.id) {
      return new Response(JSON.stringify({ error: "Invalid auth token" }), { status: 401 });
    }
    const uid = userRes.user.id;

    // Token row
    const { data: tokenRow, error: tokErr } = await admin
      .from("tokens")
      .select("id, suggested_week")
      .eq("user_id", uid)
      .eq("symbol", symbol)
      .maybeSingle();

    if (tokErr) return new Response(JSON.stringify({ error: tokErr.message }), { status: 500 });
    if (!tokenRow?.id) return new Response(JSON.stringify({ error: "Token not found for user" }), { status: 404 });

    const weekKey = isoWeekKey(new Date());
    if (!force && tokenRow.suggested_week === weekKey) {
      return new Response(JSON.stringify({ ok: true, skipped: true, weekKey }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Optional: user discount_pct aus user_settings
    // wird als "extra safety" verwendet (z.B. -2% auf alle Entries)
    let userDiscountPct = 0; // standard 0
    const { data: settings } = await admin
      .from("user_settings")
      .select("discount_pct")
      .eq("user_id", uid)
      .maybeSingle();

    if (typeof settings?.discount_pct === "number") {
      userDiscountPct = clamp(settings.discount_pct, 0, 50);
    }

    // Data
    const { mexcSymbol } = await fetchMexcLastPrice(symbol);
    const { lastPrice } = await fetchMexcLastPrice(symbol); // bewusst: garantierter live Preis

    const { highs, lows, closes } = await fetchMexcKlines(symbol, lookbackDays);

    // swing
    const swingHigh = Math.max(...closes);
    const swingLow = Math.min(...closes);

    const f618 = fib618(swingHigh, swingLow);
    const f786 = fib786(swingHigh, swingLow);

    const s20 = sma(closes, 20);
    const s50 = sma(closes, 50);

    if (s20 == null || s50 == null) {
      return new Response(JSON.stringify({ error: "Not enough data for SMA20/SMA50" }), { status: 500 });
    }

    const trend = s20 > s50 ? "UP" : "DOWN";

    const atr = atr14FromOHLC(highs, lows, closes, 14);
    if (atr == null) {
      return new Response(JSON.stringify({ error: "Not enough data for ATR14" }), { status: 500 });
    }

    const atrPct = atr / lastPrice; // relative volatility

    // "ohne altcoin season" baseline dips
    // Uptrend: eher kleiner Dip, Downtrend: deutlich größer
    const dip1 = trend === "UP" ? Math.max(0.03, atrPct * 1.2) : Math.max(0.07, atrPct * 2.0);
    const dip2 = trend === "UP" ? Math.max(0.06, atrPct * 2.0) : Math.max(0.12, atrPct * 3.0);
    const dip3 = trend === "UP" ? Math.max(0.10, atrPct * 3.0) : Math.max(0.18, atrPct * 4.0);

    // Support-Logik: wenn Kurs bereits unter 0.618, dann als "tiefere Zone" 0.786 nutzen
    const supportMid = lastPrice > f618 ? f618 : f786;

    // Entries = min(Volatilitäts-Dip, Support-Zone), aber IMMER unter Live
    // ex1: konservativ (nahe), ex2: mittel, ex3: aggressiv (tiefer)
    const raw1 = Math.min(lastPrice * (1 - dip1), supportMid);
    const raw2 = Math.min(lastPrice * (1 - dip2), f786);
    const raw3 = Math.min(lastPrice * (1 - dip3), swingLow);

    // Sicherheitsabstand: niemals >= Live (sonst sinnlos)
    const minUnderLive = 0.005; // 0.5% mind. unter Live

    const maxAllowed = lastPrice * (1 - minUnderLive);

    // userDiscount als zusätzlicher Abschlag (pro User)
    const discMul = 1 - userDiscountPct / 100;

    const ex1 = Math.min(raw1 * discMul, maxAllowed);
    const ex2 = Math.min(raw2 * discMul, maxAllowed);
    const ex3 = Math.min(raw3 * discMul, maxAllowed);

    // Prozentwerte (wie weit unter Live)
    const ex1Pct = (1 - ex1 / lastPrice) * 100;
    const ex2Pct = (1 - ex2 / lastPrice) * 100;
    const ex3Pct = (1 - ex3 / lastPrice) * 100;

    console.log("calc", {
      symbol,
      mexcSymbol,
      lastPrice,
      trend,
      sma20: s20,
      sma50: s50,
      atr,
      atrPct,
      swingHigh,
      swingLow,
      f618,
      f786,
      dips: { dip1, dip2, dip3 },
      userDiscountPct,
      ex1,
      ex2,
      ex3,
    });

    const { error: upErr } = await admin
      .from("tokens")
      .update({
        last_price: lastPrice,
        trend,
        sma20: s20,
        sma50: s50,
        atr14: atr,
        atr_pct: atrPct,
        swing_high: swingHigh,
        swing_low: swingLow,
        fib_618: f618,
        fib_786: f786,

        ex1_entry: ex1,
        ex2_entry: ex2,
        ex3_entry: ex3,
        ex1_pct: ex1Pct,
        ex2_pct: ex2Pct,
        ex3_pct: ex3Pct,

        suggested_week: weekKey,
        last_calc_at: new Date().toISOString(),
      })
      .eq("id", tokenRow.id);

    if (upErr) return new Response(JSON.stringify({ error: upErr.message }), { status: 500 });

    return new Response(
      JSON.stringify({
        ok: true,
        provider: "mexc",
        symbol,
        mexcSymbol,
        weekKey,
        lastPrice,
        trend,
        sma20: s20,
        sma50: s50,
        atr14: atr,
        atrPct,
        swingHigh,
        swingLow,
        fib: { f618, f786 },
        entries: [
          { name: "EX1", price: ex1, pctUnderLive: ex1Pct },
          { name: "EX2", price: ex2, pctUnderLive: ex2Pct },
          { name: "EX3", price: ex3, pctUnderLive: ex3Pct },
        ],
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    );
  } catch (e) {
    console.error("UNCAUGHT", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});




