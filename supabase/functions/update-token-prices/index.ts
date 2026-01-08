import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type Json = Record<string, any>;

function json(data: Json, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function upper(s: any) {
  return String(s ?? "").trim().toUpperCase();
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

// CMC hat Limits – wir schicken in chunks, 100 ist praxisnah
function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

Deno.serve(async (req) => {
  const startedAt = Date.now();

  try {
    if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

    // ===== Cron Schutz (wie bei check-entry-alerts) =====
    const CRON_SECRET = (Deno.env.get("CRON_SECRET") || "").trim();
    if (CRON_SECRET) {
      const got = (req.headers.get("x-cron-secret") || "").trim();
      if (got !== CRON_SECRET) return new Response("Unauthorized", { status: 401 });
    }

    const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
    const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();

    if (!supabaseUrl || !serviceKey) {
      return json(
        {
          error: "Missing env",
          details: { hasSupabaseUrl: !!supabaseUrl, hasServiceKey: !!serviceKey },
        },
        500
      );
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // ===== 1) Alle Tokens holen =====
    const { data: tokens, error: tokErr } = await admin
      .from("tokens")
      .select("id,user_id,symbol");

    if (tokErr) return json({ error: "tokens query failed", details: tokErr.message }, 500);
    if (!tokens?.length) return json({ ok: true, note: "no tokens", updated_rows: 0 }, 200);

    // userIds
    const userIds = uniq(tokens.map((t: any) => String(t.user_id ?? "")).filter(Boolean));
    const users_total = userIds.length;

    // ===== 2) Keys aus user_api_keys + user_settings =====
    // user_api_keys
    const { data: keys1, error: k1Err } = await admin
      .from("user_api_keys")
      .select("user_id, cmc_api_key")
      .in("user_id", userIds);

    if (k1Err) return json({ error: "user_api_keys query failed", details: k1Err.message }, 500);

    // user_settings (fallback)
    const { data: keys2, error: k2Err } = await admin
      .from("user_settings")
      .select("user_id, cmc_api_key")
      .in("user_id", userIds);

    if (k2Err) return json({ error: "user_settings query failed", details: k2Err.message }, 500);

    const keyByUser = new Map<string, string>();

    for (const r of keys1 ?? []) {
      const uid = String((r as any).user_id ?? "");
      const k = String((r as any).cmc_api_key ?? "").trim();
      if (uid && k) keyByUser.set(uid, k);
    }
    for (const r of keys2 ?? []) {
      const uid = String((r as any).user_id ?? "");
      const k = String((r as any).cmc_api_key ?? "").trim();
      // nur setzen, wenn noch kein Key aus user_api_keys da war
      if (uid && k && !keyByUser.has(uid)) keyByUser.set(uid, k);
    }

    // ===== 3) Tokens pro User gruppieren =====
    const tokensByUser = new Map<string, any[]>();
    for (const t of tokens as any[]) {
      const uid = String(t.user_id ?? "");
      if (!uid) continue;
      const arr = tokensByUser.get(uid) ?? [];
      arr.push(t);
      tokensByUser.set(uid, arr);
    }

    let users_processed = 0;
    let users_skipped_no_key = 0;
    let cmc_errors = 0;
    let updated_rows = 0;

    const nowIso = new Date().toISOString();
    const missingSymbolsSample: Record<string, string[]> = {};

    // ===== 4) Pro User CMC holen + DB updaten =====
    for (const uid of userIds) {
      const cmcKey = keyByUser.get(uid);
      if (!cmcKey) {
        users_skipped_no_key++;
        continue;
      }

      const userTokens = tokensByUser.get(uid) ?? [];
      if (!userTokens.length) continue;

      const symbols = uniq(userTokens.map((t: any) => upper(t.symbol)));
      if (!symbols.length) continue;

      users_processed++;

      const prices: Record<string, number> = {};
      const missing: string[] = [];

      // CMC in Chunks
      for (const part of chunk(symbols, 100)) {
        const url =
          "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=" +
          encodeURIComponent(part.join(","));

        const res = await fetch(url, {
          headers: {
            "X-CMC_PRO_API_KEY": cmcKey,
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

        if (!res.ok) {
          cmc_errors++;
          console.error("CMC failed", {
            uid,
            status: res.status,
            body: parsed?.status ?? parsed,
          });
          continue; // wir versuchen trotzdem andere Chunks / andere User
        }

        for (const sym of part) {
          const p = parsed?.data?.[sym]?.quote?.USD?.price;
          if (typeof p === "number" && Number.isFinite(p)) prices[sym] = p;
          else missing.push(sym);
        }
      }

      // sample missing log (nicht explodieren lassen)
      if (missing.length) missingSymbolsSample[uid] = missing.slice(0, 50);

      // ===== 5) DB Updates =====
      // Wir updaten nur Rows, die wir wirklich haben.
      // Update per Token-ID ist am saubersten, damit keine Symbol-Kollisionen passieren.
      for (const t of userTokens) {
        const sym = upper(t.symbol);
        const p = prices[sym];
        if (!Number.isFinite(p)) continue;

        const { error: upErr } = await admin
          .from("tokens")
          .update({ last_price: p, last_calc_at: nowIso })
          .eq("id", String(t.id));

        if (!upErr) updated_rows++;
        else console.error("token update failed", { id: t.id, uid, sym, err: upErr.message });
      }
    }

    return json({
      ok: true,
      at: nowIso,
      users_total,
      users_processed,
      users_skipped_no_key,
      cmc_errors,
      updated_rows,
      tookMs: Date.now() - startedAt,
      missingSymbolsSample,
    });
  } catch (e) {
    console.error("update-token-prices exception", String(e));
    return json({ error: "exception", details: String(e) }, 500);
  }
});
