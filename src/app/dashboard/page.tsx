"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type TokenRow = {
  id: string;
  symbol: string;
  avg_price: number | null;
  entry_price: number | null;
  best_buy_price: number | null;
  exit1_pct: number | null;
  trend: string | null;
  last_price: number | null;
  active_entry_label: string | null;
  order_set?: boolean | null;
  notes?: string | null;
};

function fmt(v: number | null, d = 8) {
  if (v == null || !Number.isFinite(v)) return "-";
  return v.toFixed(d);
}
function pct(v: number | null, d = 2) {
  if (v == null || !Number.isFinite(v)) return "-";
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
}

export default function DashboardPage() {
  const router = useRouter();

  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const S: any = {
    page: { minHeight: "100vh", backgroundColor: "#020617" },
    wrap: { maxWidth: 980, margin: "0 auto", padding: 16 },
    title: { color: "#fff", fontSize: 34, fontWeight: 900 },
    sub: { color: "#94a3b8", marginTop: 6 },
    grid: { display: "grid", gap: 18, marginTop: 18 },
    card: {
      backgroundColor: "#020617",
      border: "1px solid rgba(148,163,184,0.35)",
      borderRadius: 22,
      padding: 18,
    },
    symbol: { color: "#fff", fontSize: 34, fontWeight: 900 },
    kv: { marginTop: 12, color: "#cbd5e1", lineHeight: 1.7, fontSize: 16 },
    k: { color: "#93a4be" },
    v: { color: "#e2e8f0", fontWeight: 900 },
    divider: { height: 1, background: "rgba(148,163,184,0.25)", margin: "16px 0" },
    btnRow: { display: "flex", gap: 10, flexWrap: "wrap" as const },
    btn: {
      backgroundColor: "#0f172a",
      padding: "10px 14px",
      borderRadius: 14,
      color: "#fff",
      border: "1px solid #1f2937",
      cursor: "pointer",
      fontWeight: 900,
    },
  };

  async function load() {
    setLoading(true);
    setErr(null);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      router.replace("/login");
      return;
    }

    const { data, error } = await supabase
      .from("tokens")
      .select(
        "id,symbol,avg_price,entry_price,best_buy_price,exit1_pct,trend,last_price,active_entry_label,order_set,notes"
      )
      .order("symbol");

    if (error) {
      setErr(error.message);
      setTokens([]);
    } else {
      setTokens(data as TokenRow[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const sorted = useMemo(
    () =>
      [...tokens].sort((a, b) =>
        a.symbol.localeCompare(b.symbol, undefined, { sensitivity: "base" })
      ),
    [tokens]
  );

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <h1 style={S.title}>Invest Dashboard</h1>
        <div style={S.sub}>Tokens, Live-Kurse + deine Werte</div>

        {err && <div style={{ color: "tomato", fontWeight: 900 }}>{err}</div>}
        {loading && <div style={{ color: "#94a3b8" }}>Lade…</div>}

        <div style={S.grid}>
          {sorted.map((t) => {
            const live = t.last_price;
            const bb = t.best_buy_price;
            const pctAkt =
              live != null && bb != null && bb !== 0
                ? ((live - bb) / bb) * 100
                : null;
            const pctColor =
              pctAkt == null ? "#94a3b8" : pctAkt >= 0 ? "#22c55e" : "#ef4444";

            const zielkurs =
              bb != null && t.exit1_pct != null
                ? bb * (1 + t.exit1_pct / 100)
                : null;

            return (
              <div
                key={t.id}
                style={S.card}
                ref={(el) => (cardRefs.current[t.id] = el)}
              >
                <div style={S.symbol}>{t.symbol}</div>

                {/* 🔥 Live + BB + % in EINER Zeile */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 14,
                    color: "#94a3b8",
                    marginTop: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span>
                    Live:{" "}
                    <b style={{ color: "#e2e8f0" }}>{fmt(live)}</b>
                  </span>

                  <span>·</span>

                  <span>
                    BB:{" "}
                    <b style={{ color: "#e2e8f0" }}>{fmt(bb)}</b>
                  </span>

                  <span>·</span>

                  <span style={{ fontWeight: 900, color: pctColor }}>
                    {pctAkt == null ? "-" : `${pctAkt.toFixed(2)}%`}
                  </span>
                </div>

                <div style={S.kv}>
                  <div>
                    <span style={S.k}>Exit 1:</span>{" "}
                    <span style={S.v}>{pct(t.exit1_pct)}</span>{" "}
                    <span style={{ marginLeft: 12, color: "#93a4be" }}>
                      Zielkurs:{" "}
                      <b style={{ color: "#e2e8f0" }}>{fmt(zielkurs)}</b>
                    </span>
                  </div>

                  <div>
                    <span style={S.k}>Entry (aktiv):</span>{" "}
                    <span style={S.v}>{fmt(t.entry_price)}</span>{" "}
                    <span style={{ color: "#93a4be" }}>
                      {t.active_entry_label ? `(${t.active_entry_label})` : ""}
                    </span>
                  </div>

                  <div>
                    <span style={S.k}>Trend:</span>{" "}
                    <span style={S.v}>{t.trend ?? "-"}</span>
                  </div>

                  <div>
                    <span style={S.k}>Order gesetzt:</span>{" "}
                    <span
                      style={{
                        ...S.v,
                        color: t.order_set ? "#22c55e" : "#94a3b8",
                      }}
                    >
                      {t.order_set ? "Ja" : "Nein"}
                    </span>
                  </div>

                  <div>
                    <span style={S.k}>Notizen:</span>{" "}
                    <span style={S.v}>
                      {t.notes?.trim() ? t.notes : "-"}
                    </span>
                  </div>
                </div>

                <div style={S.divider} />

                <div style={S.btnRow}>
                  <button
                    style={S.btn}
                    onClick={() => router.push("/explore")}
                  >
                    Explore
                  </button>
                  <button
                    style={S.btn}
                    onClick={() => router.push("/tokens/new")}
                  >
                    Token erfassen
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
