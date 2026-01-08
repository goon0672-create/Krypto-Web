import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type Json = Record<string, unknown>;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: Json, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function nowIso() {
  return new Date().toISOString();
}

function addMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function isFiniteNumber(v: any) {
  return typeof v === "number" && Number.isFinite(v);
}

// Exit-Zielpreis (Exit1) berechnen (robust):
// Basis: best_buy_price > entry_price > avg_price
function calcExitTarget(token: any): number | null {
  const base =
    (isFiniteNumber(token.best_buy_price) ? token.best_buy_price : null) ??
    (isFiniteNumber(token.entry_price) ? token.entry_price : null) ??
    (isFiniteNumber(token.avg_price) ? token.avg_price : null);

  const pct = isFiniteNumber(token.exit1_pct) ? token.exit1_pct : null;
  if (base == null || pct == null) return null;

  return base * (1 + pct / 100);
}

Deno.serve(async (req) => {
  try {
    // 0) CORS Preflight
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: CORS_HEADERS });
    }
    if (req.method !== "POST") {
      return json({ error: "Use POST" }, 405);
    }

    // 1) Cron/Auth Check (eigener Secret Header)
    const CRON_SECRET = (Deno.env.get("CRON_SECRET") || "").trim();
    if (!CRON_SECRET) {
      return json({ error: "Missing CRON_SECRET (Supabase Function Secret)" }, 500);
    }

    const got = (req.headers.get("x-cron-secret") || "").trim();
    if (got !== CRON_SECRET) {
      return json({ error: "Unauthorized", hint: "Invalid x-cron-secret" }, 401);
    }

    // 2) Env
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
    const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();

    const vapidPublic = (Deno.env.get("VAPID_PUBLIC_KEY") || "").trim();
    const vapidPrivate = (Deno.env.get("VAPID_PRIVATE_KEY") || "").trim();
    const vapidSubject = (Deno.env.get("VAPID_SUBJECT") || "").trim();

    if (!supabaseUrl || !serviceKey) {
      return json({ error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }
    if (!vapidPublic || !vapidPrivate || !vapidSubject) {
      return json({ error: "Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT" }, 500);
    }

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const admin = createClient(supabaseUrl, serviceKey);

    // 3) Logik-Config
    const COOLDOWN_MINUTES = 120; // 2h
    const EXIT_NEAR_PCT = 45.0;   // innerhalb 45% unter Ziel

    // 4) Subscriptions laden
    const { data: subs, error: subErr } = await admin
      .from("push_subscriptions")
      .select("user_id, endpoint, p256dh, auth");

    if (subErr) return json({ error: "push_subscriptions query failed", details: subErr.message }, 500);
    if (!subs?.length) return json({ ok: true, message: "no subscriptions" }, 200);

    const userIds = Array.from(new Set(subs.map((s: any) => s.user_id)));

    // 5) Tokens laden
    const { data: tokens, error: tokErr } = await admin
      .from("tokens")
      .select("id,user_id,symbol,last_price,entry_price,best_buy_price,avg_price,exit1_pct");

    if (tokErr) return json({ error: "tokens query failed", details: tokErr.message }, 500);

    const tokensByUser = new Map<string, any[]>();
    for (const t of tokens || []) {
      if (!t?.user_id) continue;
      const arr = tokensByUser.get(t.user_id) || [];
      arr.push(t);
      tokensByUser.set(t.user_id, arr);
    }

    // 6) push_events (cooldown/state)
    const { data: events, error: evErr } = await admin
      .from("push_events")
      .select("user_id, token_id, kind, active, cooldown_until");

    if (evErr) return json({ error: "push_events query failed", details: evErr.message }, 500);

    const keyOf = (u: string, tokenId: string, kind: string) => `${u}::${tokenId}::${kind}`;
    const eventsMap = new Map<string, any>();
    for (const e of events || []) eventsMap.set(keyOf(e.user_id, e.token_id, e.kind), e);

    let checked = 0;
    let sent = 0;
    let removed = 0;

    async function sendToUser(userId: string, payload: any) {
      const userSubs = subs.filter((s: any) => s.user_id === userId);
      if (!userSubs.length) return;

      const message = JSON.stringify(payload);

      for (const s of userSubs) {
        const subscription = {
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
        };

        try {
          await webpush.sendNotification(subscription as any, message);
          sent++;
        } catch (e: any) {
          const statusCode = e?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            removed++;
            await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          } else {
            console.log("push send error", statusCode, String(e?.message ?? e));
          }
        }
      }
    }

    async function shouldFire(userId: string, tokenId: string, kind: "ENTRY_REACHED" | "EXIT1_NEAR") {
      const ev = eventsMap.get(keyOf(userId, tokenId, kind));
      if (!ev?.active) return true;

      const cd = ev.cooldown_until ? new Date(ev.cooldown_until).getTime() : 0;
      if (cd > Date.now()) return false;

      return true;
    }

    async function markFired(userId: string, tokenId: string, kind: "ENTRY_REACHED" | "EXIT1_NEAR") {
      const cooldown_until = addMinutes(COOLDOWN_MINUTES);

      await admin.from("push_events").upsert(
        {
          user_id: userId,
          token_id: tokenId,
          kind,
          active: true,
          last_sent_at: nowIso(),
          cooldown_until,
          updated_at: nowIso(),
        },
        { onConflict: "user_id,token_id,kind" } as any
      );

      eventsMap.set(keyOf(userId, tokenId, kind), { user_id: userId, token_id: tokenId, kind, active: true, cooldown_until });
    }

    async function resetEvent(userId: string, tokenId: string, kind: "ENTRY_REACHED" | "EXIT1_NEAR") {
      await admin.from("push_events").upsert(
        {
          user_id: userId,
          token_id: tokenId,
          kind,
          active: false,
          updated_at: nowIso(),
        },
        { onConflict: "user_id,token_id,kind" } as any
      );

      eventsMap.set(keyOf(userId, tokenId, kind), { user_id: userId, token_id: tokenId, kind, active: false });
    }

    // 7) Hauptlogik
    for (const userId of userIds) {
      const userTokens = tokensByUser.get(userId) || [];
      if (!userTokens.length) continue;

      for (const t of userTokens) {
        checked++;

        const live = isFiniteNumber(t.last_price) ? t.last_price : null;
        if (live == null) {
          await resetEvent(userId, t.id, "ENTRY_REACHED");
          await resetEvent(userId, t.id, "EXIT1_NEAR");
          continue;
        }

        // A) ENTRY erreicht: live <= entry_price
        const entry = isFiniteNumber(t.entry_price) ? t.entry_price : null;
        const entryCond = entry != null ? live <= entry : false;

        if (entryCond) {
          if (await shouldFire(userId, t.id, "ENTRY_REACHED")) {
            await sendToUser(userId, {
              title: `${t.symbol} – Entry erreicht`,
              body: `Live ${live} ist <= Entry ${entry}.`,
              icon: "/icons/icon-192.png",
              badge: "/icons/icon-192.png",
              data: { url: "/dashboard" },
            });
            await markFired(userId, t.id, "ENTRY_REACHED");
          }
        } else {
          await resetEvent(userId, t.id, "ENTRY_REACHED");
        }

        // B) EXIT1 near
        const target = calcExitTarget(t);
        if (target != null && target > 0) {
          const threshold = target * (1 - EXIT_NEAR_PCT / 100);
          const exitNearCond = live >= threshold && live < target;

          if (exitNearCond) {
            if (await shouldFire(userId, t.id, "EXIT1_NEAR")) {
              const distPct = ((target - live) / target) * 100;
              await sendToUser(userId, {
                title: `${t.symbol} – Exit 1 fast erreicht`,
                body: `Nur noch ${distPct.toFixed(2)}% bis zum Ziel. (Live ${live} / Ziel ${target})`,
                icon: "/icons/icon-192.png",
                badge: "/icons/icon-192.png",
                data: { url: "/dashboard" },
              });
              await markFired(userId, t.id, "EXIT1_NEAR");
            }
          } else {
            await resetEvent(userId, t.id, "EXIT1_NEAR");
          }
        } else {
          await resetEvent(userId, t.id, "EXIT1_NEAR");
        }
      }
    }

    return json({ ok: true, checked, sent, removed }, 200);
  } catch (e) {
    return json({ error: "exception", details: String(e) }, 500);
  }
});
