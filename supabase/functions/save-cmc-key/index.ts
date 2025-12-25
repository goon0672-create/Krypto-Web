import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response("Missing Authorization", { status: 401 });

    const body = await req.json().catch(() => ({}));
    const cmcApiKey = String(body?.cmcApiKey ?? "").trim();

    if (!cmcApiKey || cmcApiKey.length < 10) {
      return new Response(JSON.stringify({ error: "Invalid cmcApiKey" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User aus JWT ermitteln
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userRes, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userRes?.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Admin-Client schreibt Key in DB
    const supabaseAdmin = createClient(supabaseUrl, serviceRole);

    const { error: upErr } = await supabaseAdmin
      .from("user_api_keys")
      .upsert({
        user_id: userRes.user.id,
        cmc_api_key: cmcApiKey,
        updated_at: new Date().toISOString(),
      });

    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
