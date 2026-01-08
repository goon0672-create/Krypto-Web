"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type TokenRow = {
  id: string;
  symbol: string;
  avg_price: number | null;
  entry_price: number | null;
  best_buy_price: number | null;
  exit1_pct: number | null;
  active_entry_label: string | null;
};

function toNum(s: string): number | null {
  const v = String(s ?? "")
    .trim()
    .replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function EditTokenPage() {
  const router = useRouter();
  const params = useParams();
  const id = String((params as any)?.id ?? "");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [symbol, setSymbol] = useState("");
  const [avg, setAvg] = useState("");
  const [entry, setEntry] = useState("");
  const [bestBuy, setBestBuy] = useState("");
  const [exit1, setExit1] = useState("");

  const S: any = {
    page: { minHeight: "100vh", background: "#0b0f14", padding: 24, color: "white" },
    card: {
      maxWidth: 560,
      margin: "0 auto",
      border: "1px solid #334155",
      borderRadius: 16,
      padding: 16,
      background: "#0b0f14",
    },
    h1: { margin: 0, fontSize: 24, fontWeight: 900 },
    label: { color: "#cbd5e1", marginTop: 12, marginBottom: 6, fontWeight: 700 },
    input: {
      width: "100%",
      border: "1px solid #334155",
      borderRadius: 14,
      padding: 14,
      color: "white",
      background: "#0b0f14",
      outline: "none",
    },
    row: { display: "flex", gap: 8, flexWrap: "wrap" as const, marginTop: 14 },
    btnPrimary: {
      padding: "12px 14px",
      borderRadius: 14,
      background: "#2563eb",
      color: "white",
      border: 0,
      cursor: "pointer",
      fontWeight: 900,
    },
    btnDark: {
      padding: "12px 14px",
      borderRadius: 14,
      background: "#111827",
      color: "white",
      border: 0,
      cursor: "pointer",
      fontWeight: 900,
    },
    btnDanger: {
      padding: "12px 14px",
      borderRadius: 14,
      background: "#7f1d1d",
      color: "white",
      border: 0,
      cursor: "pointer",
      fontWeight: 900,
    },
    err: { color: "tomato", marginTop: 12, fontWeight: 900 },
    hint: { color: "#94a3b8", marginTop: 10, fontSize: 13 },
  };

  useEffect(() => {
    (async () => {
      setErr(null);

      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) {
        router.replace("/login");
        return;
      }

      if (!id) {
        setErr("Fehlende Token-ID in URL.");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("tokens")
        .select("id,symbol,avg_price,entry_price,best_buy_price,exit1_pct,active_entry_label")
        .eq("id", id)
        .maybeSingle();

      if (error) {
        setErr(error.message);
        setLoading(false);
        return;
      }

      const t = (data as TokenRow | null) ?? null;
      if (!t) {
        setErr("Token nicht gefunden (oder keine Rechte).");
        setLoading(false);
        return;
      }

      setSymbol(String(t.symbol ?? ""));
      setAvg(t.avg_price != null ? String(t.avg_price) : "");
      setEntry(t.entry_price != null ? String(t.entry_price) : "");
      setBestBuy(t.best_buy_price != null ? String(t.best_buy_price) : "");
      setExit1(t.exit1_pct != null ? String(t.exit1_pct) : "");

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function save() {
    setErr(null);

    const sym = symbol.trim().toUpperCase();
    if (!sym) {
      setErr("Token Symbol fehlt.");
      return;
    }

    const avgPrice = toNum(avg);
    const entryPrice = toNum(entry);
    const bestBuyPrice = toNum(bestBuy);
    const exit1Pct = toNum(exit1);

    const payload: any = {
      symbol: sym,
      avg_price: avgPrice,
      entry_price: entryPrice,
      best_buy_price: bestBuyPrice,
      exit1_pct: exit1Pct,
    };

    // wie in Android: wenn Entry gesetzt -> Label MANUELL
    if (entryPrice != null) payload.active_entry_label = "MANUELL";
    if (entryPrice == null) payload.active_entry_label = null;

    setBusy(true);
    const { error } = await supabase.from("tokens").update(payload).eq("id", id);
    setBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    router.push("/dashboard");
  }

  async function remove() {
    if (!confirm("Token wirklich löschen?")) return;

    setErr(null);
    setBusy(true);
    const { error } = await supabase.from("tokens").delete().eq("id", id);
    setBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    router.push("/dashboard");
  }

  if (loading) return <div style={S.page}>Lade…</div>;

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <h1 style={S.h1}>Token bearbeiten</h1>
          <button style={S.btnDark} onClick={() => router.push("/dashboard")}>
            Zurück
          </button>
        </div>

        {err && <div style={S.err}>{err}</div>}

        <div style={S.label}>Symbol</div>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="z.B. BTC"
          style={S.input}
          autoCapitalize="characters"
        />

        <div style={S.label}>Durchschnitt (Info)</div>
        <input
          value={avg}
          onChange={(e) => setAvg(e.target.value)}
          placeholder="z.B. 0.1234"
          inputMode="decimal"
          style={S.input}
        />

        <div style={S.label}>Entry (aktiv)</div>
        <input
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          placeholder="z.B. 0.1000"
          inputMode="decimal"
          style={S.input}
        />

        <div style={S.label}>Best Buy</div>
        <input
          value={bestBuy}
          onChange={(e) => setBestBuy(e.target.value)}
          placeholder="z.B. 0.0950"
          inputMode="decimal"
          style={S.input}
        />

        <div style={S.label}>Exit 1 (%)</div>
        <input
          value={exit1}
          onChange={(e) => setExit1(e.target.value)}
          placeholder="z.B. 25"
          inputMode="decimal"
          style={S.input}
        />

        <div style={S.row}>
          <button disabled={busy} style={{ ...S.btnPrimary, opacity: busy ? 0.7 : 1 }} onClick={save}>
            {busy ? "Speichern…" : "Speichern"}
          </button>

          <button disabled={busy} style={S.btnDark} onClick={() => router.push("/dashboard")}>
            Abbrechen
          </button>

          <button disabled={busy} style={S.btnDanger} onClick={remove}>
            Löschen
          </button>
        </div>

        <div style={S.hint}>
          Dezimalpunkt oder Komma ist ok (wird intern normalisiert).
        </div>
      </div>
    </div>
  );
}

