import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/* =========================
   TYPES
========================= */

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  sound?: "default";
  data?: Record<string, unknown>;
};

/* =========================
   EDGE FUNCTION
========================= */

Deno.serve(async (req) => {
  try {
    /* ---------- METHOD ---------- */
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    /* ---------- AUTH ---------- */
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    /* ---------- ENV ---------- */
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return new Response(
        JSON.stringify({ error: "Missing Supabase environment variables" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    /* ---------- USER (JWT) ---------- */
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userRes, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userRes?.user) {
      return new Response(
        JSON.stringify({ error: "Invalid session" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const userId = userRes.user.id;

    /* ---------- ADMIN CLIENT ---------- */
    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    /* ---------- TOKENS ---------- */
    const { data: devices, error: devErr } = await supabaseAdmin
      .from("push_devices")
      .select("expo_push_token")
      .eq("user_id", userId);

    if (devErr) {
      return new Response(
        JSON.stringify({ error: devErr.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const tokens = (devices ?? [])
      .map((d: any) => String(d.expo_push_token ?? ""))
      .filter((t: string) => t.startsWith("ExponentPushToken"));

    if (!tokens.length) {
      return new Response(
        JSON.stringify({
          error: "No valid Expo push token found",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    /* ---------- BODY (optional) ---------- */
    const bodyJson = await req.json().catch(() => ({}));
    const title = String(bodyJson?.title ?? "Test Push");
    const body = String(bodyJson?.body ?? "Push funktioniert ✅");

    /* ---------- BUILD MESSAGES ---------- */
    const messages: ExpoPushMessage[] = tokens.map((to) => ({
      to,
      title,
      body,
      sound: "default",
      data: {
        kind: "test_push",
        at: new Date().toISOString(),
      },
    }));

    /* ---------- SEND TO EXPO ---------- */
    const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });

    const expoJson = await expoRes.json().catch(() => ({}));

    /* ---------- HARD VALIDATION ---------- */
    const dataArr = Array.isArray((expoJson as any)?.data)
      ? (expoJson as any).data
      : [];

    const tokenErrors = dataArr.filter((x: any) => x?.status === "error");

    if (!expoRes.ok || tokenErrors.length) {
      return new Response(
        JSON.stringify({
          error: "Expo push rejected",
          httpStatus: expoRes.status,
          expoResponse: expoJson,
          tokenErrors,
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    /* ---------- SUCCESS ---------- */
    return new Response(
      JSON.stringify({
        ok: true,
        sent: tokens.length,
        expo: expoJson,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }


};

};

});
