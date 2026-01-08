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
  const [avg, setAvg] = useState("");
  const [entry, setEntry] = useState("");
  const [bestBuy, setBestBuy] = useState("");
  const [exit1, setExit1] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data?.user) router.replace("/login");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function triggerPriceCalc(sym: string) {
    // Trigger supabase edge function, damit last_price/last_calc_at gleich gesetzt werden
    const { data: session } = await supabase.auth.getSession();
    const jwt = session?.session?.access_token;

    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/cmc-entry`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ symbol: sym, lookbackDays: 90, force: true }),
    });

    // cmc-entry liefert evtl. ok:false, aber DB kann trotzdem aktualisiert worden sein.
    // Wir werfen nur bei echten HTTP Problemen.
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`cmc-entry HTTP ${res.status} ${txt}`);
    }
  }

  async function save() {
    setErr(null);

    const sym = symbol.trim().toUpperCase();
    if (!sym) {
      setErr("Symbol fehlt.");
      return;
    }

    const avgNum = parseNum(avg);
    const entryNum = parseNum(entry);
    const bestBuyNum = parseNum(bestBuy);
    const exit1Num = parseNum(exit1);

    setBusy(true);

    // last_calc_at=null / last_price=null ist ok, ABER danach müssen wir calc triggern.
    const payload: any = {
      symbol: sym,
      avg_price: avgNum,
      entry_price: entryNum,
      best_buy_price: bestBuyNum,
      exit1_pct: exit1Num,
      last_calc_at: null,
      last_price: null,
      active_entry_label: entryNum != null ? "MANUELL" : null,
    };

    // Insert + select (damit wir sauber wissen, dass Insert wirklich durch ist)
    const { data: inserted, error } = await supabase
      .from("tokens")
      .insert(payload)
      .select("id,symbol")
      .single();

    if (error) {
      setBusy(false);
      setErr(error.message);
      return;
    }

    // Danach Kurs/Trend berechnen (damit Dashboard sofort Live-Wert hat)
    try {
      await triggerPriceCalc(sym);
    } catch (e: any) {
      // Kein harter Abbruch: Token ist gespeichert, nur Live-Daten fehlen ggf.
      setErr(`Token gespeichert, aber Kurs-Update fehlgeschlagen: ${String(e?.message ?? e)}`);
    } finally {
      setBusy(false);
    }

    // Dashboard zeigt dann nach Reload den last_price
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
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="z.B. BTC"
            style={{ width: "100%", padding: 14, borderRadius: 12 }}
          />
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
