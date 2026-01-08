import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ hasKey: false, error: "Missing Authorization" }, 200);

    const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
    const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") || "").trim();
    const serviceRole = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();

    if (!supabaseUrl || !anonKey || !serviceRole) {
      return json(
        {
          hasKey: false,
          error: "Missing env",
          details: {
            hasSupabaseUrl: !!supabaseUrl,
            hasAnonKey: !!anonKey,
            hasServiceRole: !!serviceRole,
          },
        },
        200
      );
    }

    // 1) User-ID aus JWT holen (anon client)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u?.user?.id) {
      return json({ hasKey: false, error: "Invalid session", details: uErr?.message ?? null }, 200);
    }

    const uid = u.user.id;

    // 2) Key serverseitig lesen (Service Role -> unabhängig von RLS)
    const admin = createClient(supabaseUrl, serviceRole);

    const { data, error } = await admin
      .from("user_api_keys")
      .select("cmc_api_key")
      .eq("user_id", uid)
      .maybeSingle();

    if (error) {
      return json({ hasKey: false, error: "DB error", details: error.message }, 200);
    }

    const key = String((data as any)?.cmc_api_key ?? "").trim();
    return json({ hasKey: key.length > 0 });
  } catch (e) {
    return json({ hasKey: false, error: "exception", details: String(e) }, 200);
  }
});
