"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

function parseNum(v: string): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export default function NewTokenPage() {
  const router = useRouter();

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [symbol, setSymbol] = useState("");
  const [avg, setAvg] = useState(""); // avg_price (Info)
  const [entry, setEntry] = useState(""); // entry_price (aktiv)
  const [bestBuy, setBestBuy] = useState(""); // best_buy_price
  const [exit1, setExit1] = useState(""); // exit1_pct (als Prozent, z.B. 25)

  // CMC mapping
  const [cmcId, setCmcId] = useState<number | null>(null);
  const [cmcCandidates, setCmcCandidates] = useState<any[]>([]);
  const [cmcBusy, setCmcBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data?.user) router.replace("/login");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchCmcMap() {
    setErr(null);
    setCmcCandidates([]);
    setCmcId(null);

    const sym = symbol.trim().toUpperCase();
    if (!sym) {
      setErr("Symbol fehlt (für CMC-Suche).");
      return;
    }

    const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

    if (!supabaseUrl) {
      setErr("NEXT_PUBLIC_SUPABASE_URL fehlt (Env).");
      return;
    }
    if (!anonKey) {
      setErr("NEXT_PUBLIC_SUPABASE_ANON_KEY fehlt (Env).");
      return;
    }

    setCmcBusy(true);

    try {
      const { data: sess } = await supabase.auth.getSession();
      const jwt = sess?.session?.access_token;

      if (!jwt) {
        setErr("Nicht eingeloggt (kein Access Token).");
        return;
      }

      const url = `${supabaseUrl}/functions/v1/cmc-map`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
          apikey: anonKey, // wichtig fürs Supabase Functions Gateway
        },
        body: JSON.stringify({ symbol: sym }),
      });

      const raw = await res.text();
      let out: any = {};
      try {
        out = raw ? JSON.parse(raw) : {};
      } catch {
        out = { _raw: raw };
      }

      if (!res.ok) {
        const msg = out?.error ? String(out.error) : `CMC-Suche fehlgeschlagen (${res.status})`;
        const details = out?.details ? ` – ${String(out.details)}` : "";
        const hint = out?.hint ? ` – ${String(out.hint)}` : "";
        setErr(msg + details + hint);
        return;
      }

      const results = Array.isArray(out?.results) ? out.results : [];
      if (!results.length) {
        setErr(`Kein CMC Treffer für ${sym}.`);
        return;
      }

      setCmcCandidates(results);

      const firstId = Number(results[0]?.id);
      if (Number.isFinite(firstId)) setCmcId(firstId);
    } catch (e: any) {
      setErr(`CMC-Suche Exception: ${String(e?.message ?? e)}`);
    } finally {
      setCmcBusy(false);
    }
  }

  async function save() {
    setErr(null);

    const sym = symbol.trim().toUpperCase();
    if (!sym) {
      setErr("Symbol fehlt.");
      return;
    }

    if (!cmcId) {
      setErr("Bitte zuerst CMC suchen und einen Treffer auswählen (cmc_id fehlt).");
      return;
    }

    const avgNum = parseNum(avg);
    const entryNum = parseNum(entry);
    const bestBuyNum = parseNum(bestBuy);
    const exit1Num = parseNum(exit1);

    setBusy(true);

    const payload: any = {
      symbol: sym,
      cmc_id: cmcId,
      avg_price: avgNum,
      entry_price: entryNum,
      best_buy_price: bestBuyNum,
      exit1_pct: exit1Num,
      last_calc_at: null,
      last_price: null,
      active_entry_label: entryNum != null ? "MANUELL" : null,
    };

    const { error } = await supabase.from("tokens").insert(payload);

    setBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    router.replace("/dashboard");
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Token erfassen</h1>
        <button onClick={() => router.push("/dashboard")}>Zurück</button>
      </div>

      {err && <p style={{ color: "tomato", fontWeight: 800 }}>{err}</p>}

      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <div>
          <div style={{ opacity: 0.85, marginBottom: 6 }}>Symbol</div>
          <input
            value={symbol}
            onChange={(e) => {
              setSymbol(e.target.value);
              setCmcCandidates([]);
              setCmcId(null);
            }}
            placeholder="z.B. BTC"
            style={{ width: "100%", padding: 14, borderRadius: 12 }}
          />

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <button disabled={cmcBusy || busy} onClick={fetchCmcMap} style={{ padding: "12px 16px" }}>
              {cmcBusy ? "CMC suche…" : "CMC suchen"}
            </button>

            <div style={{ opacity: 0.8 }}>
              cmc_id: <b>{cmcId ? cmcId : "nicht gesetzt"}</b>
            </div>
          </div>

          {cmcCandidates.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ opacity: 0.85, marginBottom: 6 }}>CoinMarketCap Treffer</div>
              <select
                value={cmcId ?? ""}
                onChange={(e) => setCmcId(e.target.value ? Number(e.target.value) : null)}
                style={{ width: "100%", padding: 14, borderRadius: 12 }}
              >
                {cmcCandidates.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    #{c.rank ?? "-"} · {c.symbol} · {c.name} · {c.slug} · id:{c.id} ·{" "}
                    {c.is_active ? "active" : "inactive"}
                  </option>
                ))}
              </select>

              <div style={{ opacity: 0.75, marginTop: 6 }}>
                Wenn mehrere Treffer existieren: den richtigen anhand Name/Slug auswählen.
              </div>
            </div>
          )}
        </div>

        <div>
          <div style={{ opacity: 0.85, marginBottom: 6 }}>Durchschnitt (Info) – optional</div>
          <input
            value={avg}
            onChange={(e) => setAvg(e.target.value)}
            placeholder="z.B. 0,0123"
            style={{ width: "100%", padding: 14, borderRadius: 12 }}
          />
        </div>

        <div>
          <div style={{ opacity: 0.85, marginBottom: 6 }}>Entry (aktiv) – optional</div>
          <input
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            placeholder="z.B. 0,0100"
            style={{ width: "100%", padding: 14, borderRadius: 12 }}
          />
        </div>

        <div>
          <div style={{ opacity: 0.85, marginBottom: 6 }}>Best Buy – optional</div>
          <input
            value={bestBuy}
            onChange={(e) => setBestBuy(e.target.value)}
            placeholder="z.B. 0,0090"
            style={{ width: "100%", padding: 14, borderRadius: 12 }}
          />
        </div>

        <div>
          <div style={{ opacity: 0.85, marginBottom: 6 }}>Exit 1 (%) – optional</div>
          <input
            value={exit1}
            onChange={(e) => setExit1(e.target.value)}
            placeholder="z.B. 25"
            style={{ width: "100%", padding: 14, borderRadius: 12 }}
          />
          <div style={{ opacity: 0.75, marginTop: 6 }}>
            Eingabe: 25 → gespeichert als 25 → Anzeige im Dashboard: +25%
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          <button disabled={busy} onClick={save} style={{ padding: "12px 16px" }}>
            {busy ? "Speichern…" : "Speichern"}
          </button>
          <button disabled={busy} onClick={() => router.push("/dashboard")} style={{ padding: "12px 16px" }}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
