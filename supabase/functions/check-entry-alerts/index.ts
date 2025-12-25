import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type Json = Record<string, unknown>;

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  sound?: "default";
  data?: Record<string, unknown>;
};

function json(data: Json, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function upper(s: any) {
  return String(s ?? "").trim().toUpperCase();
}

function isExpoToken(tok: string) {
  return tok.startsWith("ExpoPushToken[") || tok.startsWith("ExponentPushToken[");
}

function isOlderThanHours(iso: any, hours: number) {
  if (!iso) return true;
  const t = new Date(String(iso)).getTime();
  if (!Number.isFinite(t)) return true;
  return t <= Date.now() - hours * 60 * 60 * 1000;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    // ===== Cron Schutz =====
    const CRON_SECRET = (Deno.env.get("CRON_SECRET") || "").trim();
    if (CRON_SECRET) {
      const got = (req.headers.get("x-cron-secret") || "").trim();
      if (got !== CRON_SECRET) return new Response("Unauthorized", { status: 401 });
    }

    const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
    const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
    const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") || "").trim();
    const internalFnSecret = (Deno.env.get("INTERNAL_FN_SECRET") || "").trim();

    if (!supabaseUrl || !serviceKey || !anonKey) {
      return json(
        {
          error: "Missing env",
          details: {
            hasSupabaseUrl: !!supabaseUrl,
            hasServiceKey: !!serviceKey,
            hasAnonKey: !!anonKey,
          },
        },
        500
      );
    }
    if (!internalFnSecret) return json({ error: "INTERNAL_FN_SECRET not set" }, 500);

    const admin = createClient(supabaseUrl, serviceKey);

    // ===== 1) Tokens =====
    const { data: tokens, error: tokErr } = await admin
      .from("tokens")
      .select(
        `
        id,
        user_id,
        symbol,

        entry_price,
        entry_state,
        last_entry_push_at,

        best_buy_price,
        best_buy_state,
        last_best_buy_alert_at
        `
      );

    if (tokErr) return json({ error: "tokens query failed", details: tokErr.message }, 500);
    if (!tokens?.length) return json({ ok: true, checked: 0, pushed: 0, updated: 0 });

    // ===== 2) Preise =====
    const symbols = Array.from(new Set(tokens.map((t: any) => upper(t.symbol)).filter(Boolean)));

    const pricesRes = await fetch(`${supabaseUrl}/functions/v1/cmc-prices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        "x-internal-secret": internalFnSecret,
      },
      body: JSON.stringify({ symbols }),
    });

    const pricesText = await pricesRes.text();
    let pricesJson: any = {};
    try {
      pricesJson = JSON.parse(pricesText);
    } catch {
      pricesJson = { raw: pricesText };
    }

    if (!pricesRes.ok) {
      console.error("cmc-prices failed", JSON.stringify({ status: pricesRes.status, body: pricesJson }, null, 2));
      return json({ error: "cmc-prices failed", status: pricesRes.status, body: pricesJson }, 502);
    }

    const prices: Record<string, number> = pricesJson ?? {};

    // ===== 3) Push Prefs + Devices =====
    const userIds = Array.from(new Set(tokens.map((t: any) => String(t.user_id ?? "")).filter(Boolean)));

    const { data: prefs, error: prefErr } = await admin
      .from("push_prefs")
      .select("user_id, mode")
      .in("user_id", userIds);

    if (prefErr) return json({ error: "push_prefs query failed", details: prefErr.message }, 500);

    const modeByUser = new Map<string, string>();
    for (const p of prefs ?? []) {
      modeByUser.set(String((p as any).user_id), String((p as any).mode ?? "off").toLowerCase());
    }

    const { data: devices, error: devErr } = await admin
      .from("push_devices")
      .select("user_id, expo_push_token")
      .in("user_id", userIds);

    if (devErr) return json({ error: "push_devices query failed", details: devErr.message }, 500);

    const tokensByUser = new Map<string, string[]>();
    for (const d of devices ?? []) {
      const uid = String((d as any).user_id ?? "");
      const tok = String((d as any).expo_push_token ?? "").trim();
      if (!uid || !tok) continue;
      if (!isExpoToken(tok)) continue;

      const arr = tokensByUser.get(uid) ?? [];
      arr.push(tok);
      tokensByUser.set(uid, arr);
    }

    // ===== 4) Logic =====
    const COOLDOWN_HOURS = 4;
    const nowIso = new Date().toISOString();

    const messages: ExpoPushMessage[] = [];
    const tokenUpdates: Array<{ id: string; patch: any }> = [];
    const pushLog: any[] = [];

    for (const t of tokens as any[]) {
      const uid = String(t.user_id ?? "");
      if (!uid) continue;

      const sym = upper(t.symbol);
      const live = prices[sym];
      if (!Number.isFinite(live)) continue;

      // Push Pref: Push darf aus sein, aber STATES/REARM sollen trotzdem sauber laufen
      const mode = (modeByUser.get(uid) ?? "off").toLowerCase();
      const pushAllowed = mode !== "off" && mode !== "none" && mode !== "0";

      const pushTokens = tokensByUser.get(uid) ?? [];

      /* ---------- ENTRY ---------- */
      const entry = Number(t.entry_price);
      const entryValid = Number.isFinite(entry) && entry > 0;
      const entryReached = entryValid ? live <= entry : false;

      // State sync immer
      if (Boolean(t.entry_state) !== entryReached) {
        tokenUpdates.push({ id: String(t.id), patch: { entry_state: entryReached } });
      }

      // Rearm: wenn wieder drüber -> cooldown timestamp zurücksetzen
      if (!entryReached && t.last_entry_push_at) {
        tokenUpdates.push({ id: String(t.id), patch: { last_entry_push_at: null } });
      }

      // Push: nur wenn erlaubt + Device vorhanden + cooldown
      if (pushAllowed && entryReached && pushTokens.length && isOlderThanHours(t.last_entry_push_at, COOLDOWN_HOURS)) {
        for (const to of pushTokens) {
          messages.push({
            to,
            title: `Entry erreicht: ${sym}`,
            body: `Live ${live} ≤ Entry ${entry}`,
            sound: "default",
            data: { kind: "entry", symbol: sym, live, entry, token_id: String(t.id), at: nowIso },
          });
        }

        tokenUpdates.push({ id: String(t.id), patch: { last_entry_push_at: nowIso } });

        pushLog.push({
          user_id: uid,
          token_symbol: sym,
          kind: "entry",
          last_sent_at: nowIso,
          created_at: nowIso,
        });
      }

      /* ---------- BEST BUY +55% ---------- */
      const bb = Number(t.best_buy_price);
      const bbValid = Number.isFinite(bb) && bb > 0;
      const threshold = bbValid ? bb * 1.55 : NaN;
      const bbReached = bbValid ? live >= threshold : false;

      // State sync immer
      if (Boolean(t.best_buy_state) !== bbReached) {
        tokenUpdates.push({ id: String(t.id), patch: { best_buy_state: bbReached } });
      }

      // Rearm: wenn wieder darunter -> marker löschen
      if (!bbReached && t.last_best_buy_alert_at) {
        tokenUpdates.push({ id: String(t.id), patch: { last_best_buy_alert_at: null } });
      }

      // Push: nur wenn erlaubt + Device vorhanden + cooldown
      if (pushAllowed && bbReached && pushTokens.length && isOlderThanHours(t.last_best_buy_alert_at, COOLDOWN_HOURS)) {
        for (const to of pushTokens) {
          messages.push({
            to,
            title: `Best Buy +55%: ${sym}`,
            body: `Live ${live} ≥ Ziel ${threshold} (Best Buy ${bb})`,
            sound: "default",
            data: {
              kind: "best_buy_55",
              symbol: sym,
              live,
              best_buy_price: bb,
              threshold,
              token_id: String(t.id),
              at: nowIso,
            },
          });
        }

        tokenUpdates.push({ id: String(t.id), patch: { last_best_buy_alert_at: nowIso } });

        pushLog.push({
          user_id: uid,
          token_symbol: sym,
          kind: "best_buy_55",
          last_sent_at: nowIso,
          created_at: nowIso,
        });
      }
    }

    // ===== 5) Push senden (mit Response Check) =====
    if (messages.length) {
      const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(messages),
      });

      const expoText = await expoRes.text();
      if (!expoRes.ok) {
        console.error("Expo push failed", expoRes.status, expoText.slice(0, 500));
        // NICHT returnen -> Updates trotzdem speichern
      }
    }

    // ===== 6) SAFE Updates (kein UPSERT!) + Error Handling =====
    for (const u of tokenUpdates) {
      const { error } = await admin.from("tokens").update(u.patch).eq("id", u.id);
      if (error) console.error("tokens update failed", u.id, error.message, u.patch);
    }

    // ===== 7) push_log (best effort) =====
    if (pushLog.length) {
      try {
        const { error } = await admin.from("push_log").insert(pushLog as any);
        if (error) console.error("push_log insert failed (ignored)", error.message);
      } catch (e) {
        console.error("push_log insert exception (ignored)", String(e));
      }
    }

    return json({
      ok: true,
      checked: tokens.length,
      pushed: messages.length,
      updated: tokenUpdates.length,
      cooldownHours: COOLDOWN_HOURS,
    });
  } catch (e) {
    console.error("check-entry-alerts exception", String(e));
    return json({ error: "exception", details: String(e) }, 500);
  }
});
