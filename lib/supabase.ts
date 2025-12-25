

console.log("SUPABASE_URL =", process.env.EXPO_PUBLIC_SUPABASE_URL);
console.log("SUPABASE_ANON_KEY startsWith =", (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "").slice(0, 8));

import { createClient } from "@supabase/supabase-js";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, anon);

