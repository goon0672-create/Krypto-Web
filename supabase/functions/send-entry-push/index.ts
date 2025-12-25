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

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    // Cron Schutz
    const CRON_SECRET = (Deno.env.get("CRON_SECRET") || "").trim();
    if (CRON_SECRET) {
      const got = (req.headers.get("x-cron-secret") || "").trim();
      if (got !== CRON_SECRET) return new Response("Unauthorized", { status: 401 });
    }

    const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
    const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
    if (!supabaseUrl || !serviceKey) {
      return json(
        { error: "Missing env", hasSupabaseUrl: !!supabaseUrl, hasServiceKey: !!serviceKey },
        500
      );
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const now = new Date();
    const nowIso = now.toISOString();

    // 4h Cooldown
    const COOLDOWN_HOURS = 4;
    const sinceIso = new Date(now.getTime() - COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();

    // 1) Kandidaten: entry_state=true UND (nie gesendet ODER älter als 4h)
    const { data: tokens, error: tokErr } = await admin
      .from("tokens")
      .select("id, user_id, symbol, entry_price, entry_state, last_entry_alert_at, active_entry_label")
      .eq("entry_state", true)
      .or(`last_entry_alert_at.is.null,last_entry_alert_at.lt.${sinceIso}`);

    if (tokErr) return json({ error: "tokens query failed", details: tokErr.message }, 500);
    if (!tokens?.length) {
      return json({
        ok: true,
        note: "no candidates (entry_state=true + cooldown passed)",
        candidates: 0,
        eligible: 0,
        pushed: 0,
        sinceIso,
      });
    }

    const userIds = Array.from(new Set(tokens.map((t: any) => String(t.user_id ?? "")).filter(Boolean)));

    // 2) push_prefs: OFF blocken
    const { data: prefs, error: prefErr } = await admin
      .from("push_prefs")
      .select("user_id, mode")
      .in("user_id", userIds);

    if (prefErr) return json({ error: "push_prefs query failed", details: prefErr.message }, 500);

    const modeByUser = new Map<string, string>();
    for (const p of prefs ?? []) {
      const uid = String((p as any).user_id ?? "");
      const mode = String((p as any).mode ?? "off").toLowerCase();
      if (uid) modeByUser.set(uid, mode);
    }

    // 3) push_devices
    const { data: devices, error: devErr } = await admin
      .from("push_devices")
      .select("user_id, expo_push_token")
      .in("user_id", userIds);

    if (devErr) return json({ error: "push_devices query failed", details: devErr.message }, 500);

    const tokensByUser = new Map<string, string[]>();
    for (const d of devices ?? []) {
      const uid = String((d as any).user_id ?? "");
      const tok = String((d as any).expo_push_token ?? "").trim();
      if (!uid || !tok || !isExpoToken(tok)) continue;
      const arr = tokensByUser.get(uid) ?? [];
      arr.push(tok);
      tokensByUser.set(uid, arr);
    }

    // 4) eligible
    const eligible: any[] = [];
    let skippedNoUser = 0;
    let skippedOff = 0;
    let skippedNoDevice = 0;

    for (const t of tokens as any[]) {
      const uid = String(t.user_id ?? "");
      if (!uid) { skippedNoUser++; continue; }

      const mode = (modeByUser.get(uid) ?? "off").toLowerCase();
      if (mode === "off") { skippedOff++; continue; }

      const pushTokens = tokensByUser.get(uid) ?? [];
      if (!pushTokens.length) { skippedNoDevice++; continue; }

      eligible.push(t);
    }

    if (!eligible.length) {
      return json({
        ok: true,
        note: "no eligible (prefs/devices filtered everything)",
        candidates: tokens.length,
        eligible: 0,
        pushed: 0,
        debug: {
          userIds: userIds.length,
          prefsRows: (prefs ?? []).length,
          deviceRows: (devices ?? []).length,
          tokensByUser: tokensByUser.size,
          skippedNoUser,
          skippedOff,
          skippedNoDevice,
          exampleCandidate: {
            id: (tokens as any[])[0]?.id ?? null,
            user_id: (tokens as any[])[0]?.user_id ?? null,
            symbol: (tokens as any[])[0]?.symbol ?? null,
            last_entry_alert_at: (tokens as any[])[0]?.last_entry_alert_at ?? null,
          },
        },
      });
    }

    // 5) Messages
    const messages: ExpoPushMessage[] = [];
    const toMarkIds: string[] = [];

    for (const t of eligible) {
      const uid = String(t.user_id);
      const sym = upper(t.symbol);
      const entry = Number(t.entry_price);

      const pushTokens = tokensByUser.get(uid) ?? [];
      for (const to of pushTokens) {
        messages.push({
          to,
          title: `Entry erreicht: ${sym}`,
          body: `Live ≤ Entry (${entry}) (${t.active_entry_label ?? "AKTIV"})`,
          sound: "default",
          data: { kind: "entry_alert", token_id: t.id, symbol: sym, entry, at: nowIso },
        });
      }

      toMarkIds.push(String(t.id));
    }

    if (!messages.length) {
      return json({ ok: true, note: "eligible but no messages (no tokens?)", candidates: tokens.length, eligible: eligible.length, pushed: 0 });
    }

    // 6) Send to Expo
    const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });

    const expoText = await expoRes.text();
    let expo: any = null;
    try { expo = JSON.parse(expoText); } catch { expo = { raw: expoText }; }

    if (!expoRes.ok) {
      return json({ error: "Expo push failed", status: expoRes.status, details: expo }, 502);
    }

    // 7) Marker setzen
    const uniqIds = Array.from(new Set(toMarkIds));
    const { error: updErr } = await admin
      .from("tokens")
      .update({ last_entry_alert_at: nowIso })
      .in("id", uniqIds);

    if (updErr) {
      return json({
        ok: true,
        pushed: messages.length,
        warn: "tokens update failed",
        details: updErr.message,
        expo,
      });
    }

    // 8) push_log best effort
    try {
      const rows = eligible.map((t: any) => ({
        user_id: t.user_id,
        token_symbol: upper(t.symbol),
        last_sent_at: nowIso,
        created_at: nowIso,
      }));

      const ins = await admin.from("push_log").insert(rows as any);
      if (ins.error) console.error("push_log insert failed (ignored)", ins.error.message);
    } catch (e) {
      console.error("push_log insert exception (ignored)", String(e));
    }

    return json({
      ok: true,
      candidates: tokens.length,
      eligible: eligible.length,
      pushed: messages.length,
      marked: uniqIds.length,
      expo,
      debug: {
        sinceIso,
        userIds: userIds.length,
        prefsRows: (prefs ?? []).length,
        deviceRows: (devices ?? []).length,
        tokensByUser: tokensByUser.size,
        skippedNoUser,
        skippedOff,
        skippedNoDevice,
      },
    });
  } catch (e) {
    console.error("send-entry-push exception", String(e));
    return json({ error: "exception", details: String(e) }, 500);
  }
});


