import "react-native-url-polyfill/auto";
import Constants from "expo-constants";
import { createClient } from "@supabase/supabase-js";

function pickEnv(...vals: any[]): string {
  for (const v of vals) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

const extra: any =
  (Constants as any)?.expoConfig?.extra ??
  (Constants as any)?.manifest?.extra ??
  (Constants as any)?.manifest2?.extra ??
  {};

const SUPABASE_URL = pickEnv(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  extra.EXPO_PUBLIC_SUPABASE_URL,
  extra.SUPABASE_URL,
  extra.supabaseUrl
);

const SUPABASE_ANON_KEY = pickEnv(
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  extra.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  extra.SUPABASE_ANON_KEY,
  extra.supabaseAnonKey
);

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Das ist besser als ein "authData" Crash. Damit weißt du sofort warum es knallt.
  throw new Error("Missing Supabase config (URL/ANON). Check app.config.ts + .env");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// optional: Debug-Helper (crasht nicht)
export async function debugAuthUid() {
  const { data } = await supabase.auth.getUser();
  const uid = data?.user?.id ?? null;
  console.log("AUTH UID:", uid);
  return uid;
}


