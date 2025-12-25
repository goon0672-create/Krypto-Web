import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type FgiResponse = {
  value: number;
  classification: string;
  timestamp?: string;
};

serve(async (_req) => {
  try {
    const url = "https://api.alternative.me/fng/?limit=1&format=json";
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await res.text();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `FGI HTTP ${res.status}: ${text}` }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const j = JSON.parse(text);
    const item = j?.data?.[0];
    const value = Number(item?.value);
    const classification = String(item?.value_classification ?? "");

    if (!Number.isFinite(value)) {
      return new Response(JSON.stringify({ error: "FGI parse error" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const out: FgiResponse = {
      value,
      classification,
      timestamp: item?.timestamp ? String(item.timestamp) : undefined,
    };

    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
