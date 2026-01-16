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
  last_calc_at: string | null;
  active_entry_label: string | null;
  created_at: string | null;

  ex1_entry?: number | null;
  ex2_entry?: number | null;
  ex3_entry?: number | null;
  ex1_pct?: number | null;
  ex2_pct?: number | null;
  ex3_pct?: number | null;

  cmc_id?: number | null;
};

type EntrySuggestion = { name: "EX1" | "EX2" | "EX3"; price: number; pctUnderLive: number };

type EntryApiResponse = {
  ok: boolean;
  symbol: string;
  entries?: EntrySuggestion[];
  error?: string;
};

type FgiApiResponse = { value?: number; classification?: string; error?: string };

function toNum(v: string): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const x = Number(s.replace(",", "."));
  return Number.isFinite(x) ? x : null;
}

function fmtSmart(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "-";
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(2);
  if (abs >= 1) return v.toFixed(6);
  if (abs >= 0.01) return v.toFixed(8);
  return v.toFixed(12);
}

function fmtFixed(v: number | null | undefined, digits = 8) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "-";
  return v.toFixed(digits);
}

function fmtPctSigned(v: number | null | undefined, digits = 2) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "-";
  const x = Number(v.toFixed(digits));
  const sign = x >= 0 ? "+" : "";
  return `${sign}${x}%`;
}

function normClass(s: string | null | undefined) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function fgiLabelAndInvestPct(value: number | null | undefined, classification: string | null | undefined) {
  const v = typeof value === "number" && Number.isFinite(value) ? value : null;
  const c = normClass(classification);

  const isPanic =
    c.includes("panic") ||
    c.includes("panik") ||
    c.includes("extreme fear") ||
    (c.includes("extrem") && c.includes("angst")) ||
    (c.includes("sehr") && c.includes("angst"));

  const isFear = c.includes("fear") || c.includes("angst");
  const isNeutral = c.includes("neutral");
  const isGreed = c.includes("greed") || c.includes("gier");

  let phase = "Unbekannt";
  let investText = "-";
  let color = "#e2e8f0";

  if (isPanic) {
    phase = "Panik";
    investText = "100%";
    color = "#ef4444";
  } else if (isFear) {
    phase = "Angst";
    investText = "50 - 70%";
    color = "#f97316";
  } else if (isNeutral) {
    phase = "Neutral";
    investText = "25%";
    color = "#eab308";
  } else if (isGreed) {
    phase = "Gier";
    investText = "10%";
    color = "#22c55e";
  } else if (v != null) {
    if (v <= 25) {
      phase = "Panik";
      investText = "100%";
      color = "#ef4444";
    } else if (v <= 49) {
      phase = "Angst";
      investText = "50 - 70%";
      color = "#f97316";
    } else if (v <= 74) {
      phase = "Neutral";
      investText = "25%";
      color = "#eab308";
    } else {
      phase = "Gier";
      investText = "10%";
      color = "#22c55e";
    }
  }

  return { phase, investText, color };
}

export default function DashboardPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [symbol, setSymbol] = useState("");
  const [avg, setAvg] = useState("");
  const [entry, setEntry] = useState("");
  const [bestBuy, setBestBuy] = useState("");
  const [exit1, setExit1] = useState("");

  const [openEntry, setOpenEntry] = useState<Record<string, boolean>>({});
  const [entryBusy, setEntryBusy] = useState<Record<string, boolean>>({});
  const [entryErr, setEntryErr] = useState<Record<string, string | null>>({});

  const [openFgi, setOpenFgi] = useState<Record<string, boolean>>({});
  const [fgiBusy, setFgiBusy] = useState<Record<string, boolean>>({});
  const [fgiErr, setFgiErr] = useState<Record<string, string | null>>({});
  const [fgiData, setFgiData] = useState<Record<string, { value: number; classification: string } | null>>({});

  const [openTokenList, setOpenTokenList] = useState(false);

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [flashId, setFlashId] = useState<string | null>(null);

  const S: any = {
    page: { minHeight: "100vh", backgroundColor: "#020617" },
    wrap: { maxWidth: 980, margin: "0 auto", padding: 16 },

    top: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 12,
      flexWrap: "wrap",
      paddingTop: 8,
    },
    title: { color: "#fff", fontSize: 34, fontWeight: 900, margin: 0, letterSpacing: 0.2 },
    sub: { color: "#94a3b8", marginTop: 6, fontSize: 14 },

    row: { display: "flex", gap: 10, flexWrap: "wrap" as const, alignItems: "center" },

    btnPrimary: {
      backgroundColor: "#2563eb",
      padding: "12px 16px",
      borderRadius: 14,
      color: "#fff",
      border: 0,
      cursor: "pointer",
      fontWeight: 900,
      minWidth: 160,
    },
    btnMid: {
      backgroundColor: "#0f172a",
      padding: "12px 16px",
      borderRadius: 14,
      color: "#fff",
      border: "1px solid #1f2937",
      cursor: "pointer",
      fontWeight: 900,
      minWidth: 160,
    },
    btnDark: {
      backgroundColor: "#111827",
      padding: "12px 16px",
      borderRadius: 14,
      color: "#fff",
      border: "1px solid #1f2937",
      cursor: "pointer",
      fontWeight: 900,
      minWidth: 160,
    },
    btnDanger: {
      backgroundColor: "#7f1d1d",
      padding: "12px 16px",
      borderRadius: 14,
      color: "#fff",
      border: "1px solid #991b1b",
      cursor: "pointer",
      fontWeight: 900,
      minWidth: 160,
    },

    errTop: { color: "tomato", marginTop: 12, fontWeight: 900 },

    grid: { display: "grid", gap: 18, marginTop: 18 },

    card: {
      backgroundColor: "#020617",
      border: "1px solid rgba(148,163,184,0.35)",
      borderRadius: 22,
      padding: 18,
      boxShadow: "0 0 0 1px rgba(2,6,23,0.1), 0 20px 60px rgba(0,0,0,0.35)",
      transition: "box-shadow 220ms ease, border 220ms ease",
    },

    cardFlash: {
      border: "1px solid rgba(37,99,235,0.85)",
      boxShadow: "0 0 0 2px rgba(37,99,235,0.25), 0 20px 60px rgba(0,0,0,0.35)",
    },

    headRow: { display: "flex", gap: 14, alignItems: "center" },
    dot: { width: 16, height: 16, borderRadius: 999, background: "#22c55e", boxShadow: "0 0 0 6px rgba(34,197,94,0.12)" },
    ok: { color: "#22c55e", fontWeight: 900, fontSize: 20 },

    symbol: { color: "#fff", fontSize: 34, fontWeight: 900, marginTop: 2 },

    kv: { marginTop: 12, color: "#cbd5e1", lineHeight: 1.7, fontSize: 16 },
    k: { color: "#93a4be" },
    v: { color: "#e2e8f0", fontWeight: 900 },

    strongLine: { fontWeight: 900, color: "#e2e8f0" },

    divider: { height: 1, background: "rgba(148,163,184,0.25)", marginTop: 18, marginBottom: 14 },

    btnGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 },
    btnFull: { width: "100%", display: "flex", justifyContent: "center", alignItems: "center" },

    entryBox: { marginTop: 12, paddingTop: 8 },
    entryTitleRow: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" as const },
    entryTitle: { color: "#fff", fontSize: 22, fontWeight: 900, margin: 0 },
    entryRecalcBtn: {
      backgroundColor: "#0f172a",
      padding: "12px 16px",
      borderRadius: 14,
      color: "#fff",
      border: "1px solid #1f2937",
      cursor: "pointer",
      fontWeight: 900,
      minWidth: 220,
    },
    entryErr: { color: "tomato", fontWeight: 900, marginTop: 10 },
    entryList: { marginTop: 12, display: "grid", gap: 10 },
    entryRow: { display: "grid", gridTemplateColumns: "64px 1fr auto", gap: 10, alignItems: "center" },
    entryName: { color: "#cbd5e1", fontWeight: 900 },
    entryVal: { color: "#e2e8f0", fontWeight: 900 },
    entryPct: { color: "#93a4be", fontWeight: 900 },
    entryUseBtn: {
      backgroundColor: "#111827",
      padding: "10px 12px",
      borderRadius: 14,
      color: "#fff",
      border: "1px solid #1f2937",
      cursor: "pointer",
      fontWeight: 900,
      minWidth: 130,
      justifySelf: "end",
    },

    fgiBox: { marginTop: 12, paddingTop: 8 },
    fgiTitle: { color: "#fff", fontSize: 22, fontWeight: 900, margin: 0 },
    fgiRow: { marginTop: 10, color: "#cbd5e1", fontSize: 16, lineHeight: 1.7 },
    fgiValue: { fontWeight: 900, color: "#e2e8f0" },

    formCard: {
      marginTop: 14,
      border: "1px solid rgba(148,163,184,0.25)",
      borderRadius: 18,
      padding: 14,
      backgroundColor: "rgba(2,6,23,0.35)",
    },
    formTitle: { color: "#fff", fontSize: 18, fontWeight: 900, margin: 0 },
    label: { color: "#cbd5e1", marginTop: 10, fontWeight: 800 },
    input: {
      width: "100%",
      marginTop: 8,
      border: "1px solid #334155",
      borderRadius: 14,
      padding: 14,
      color: "white",
      backgroundColor: "#020617",
      outline: "none",
      fontSize: 16,
    },

    overlay: {
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.55)",
      display: "flex",
      justifyContent: "center",
      alignItems: "flex-start",
      padding: 16,
      zIndex: 50,
    },
    overlayCard: {
      marginTop: 70,
      width: "min(520px, 100%)",
      backgroundColor: "#020617",
      border: "1px solid rgba(148,163,184,0.35)",
      borderRadius: 18,
      padding: 14,
      boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      display: "flex",
      flexDirection: "column",
      maxHeight: "calc(100vh - 120px)",
      minHeight: 0,
    },
    overlayTitleRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 },
    overlayTitle: { color: "#fff", fontSize: 18, fontWeight: 900, margin: 0 },
    tokenList: { marginTop: 12, display: "grid", gap: 10, overflowY: "auto", flex: "1 1 auto", minHeight: 0, paddingRight: 4, WebkitOverflowScrolling: "touch" },
    tokenItemBtn: { width: "100%", backgroundColor: "#0f172a", border: "1px solid #1f2937", color: "#fff", padding: "12px 14px", borderRadius: 14, cursor: "pointer", fontWeight: 900, textAlign: "left" as const },
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
        "id,symbol,cmc_id,avg_price,entry_price,best_buy_price,exit1_pct,trend,last_price,last_calc_at,active_entry_label,created_at,ex1_entry,ex2_entry,ex3_entry,ex1_pct,ex2_pct,ex3_pct"
      )
      .order("symbol", { ascending: true });

    if (error) {
      setErr(error.message);
      setTokens([]);
      setLoading(false);
      return;
    }

    setTokens((data as any) ?? []);
    setLoading(false);
  }

  // ✅ Reload = NUR Preise (serverseitig), keine EX Berechnung
  async function refreshPricesAndReload() {
    setErr(null);

    const { data, error } = await supabase.functions.invoke("cmc-reload-prices", {
      body: {},
    });

    if (error) {
      setErr(`cmc-reload-prices Fehler: ${error.message}`);
      return;
    }
    if (!data?.ok) {
      setErr(data?.error ? String(data.error) : "cmc-reload-prices: Antwort ohne ok=true");
      return;
    }

    await load();
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  function resetEditForm() {
    setEditingId(null);
    setSymbol("");
    setAvg("");
    setEntry("");
    setBestBuy("");
    setExit1("");
  }

  function startAdd() {
    resetEditForm();
    router.push("/tokens/new");
  }

  function startEditInline(t: TokenRow) {
    setEditingId(t.id);
    setSymbol(String(t.symbol ?? ""));
    setAvg(t.avg_price != null ? String(t.avg_price) : "");
    setEntry(t.entry_price != null ? String(t.entry_price) : "");
    setBestBuy(t.best_buy_price != null ? String(t.best_buy_price) : "");
    setExit1(t.exit1_pct != null ? String(t.exit1_pct) : "");
    setErr(null);

    setTimeout(() => {
      const el = cardRefs.current[t.id];
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  }

  async function saveTokenInline() {
    if (!editingId) return;

    const sym = symbol.trim().toUpperCase();
    if (!sym) return setErr("Token Symbol fehlt.");

    const avgN = toNum(avg);
    const entryN = toNum(entry);
    const bbN = toNum(bestBuy);
    const ex1N = toNum(exit1);

    if (ex1N != null && (ex1N < -100000 || ex1N > 100000)) return setErr("Exit1% ist unplausibel.");

    setSaving(true);
    setErr(null);

    const payload: any = {
      symbol: sym,
      avg_price: avgN,
      entry_price: entryN,
      best_buy_price: bbN,
      exit1_pct: ex1N,
    };
    if (entryN != null) payload.active_entry_label = "MANUELL";

    const res = await supabase.from("tokens").update(payload).eq("id", editingId);

    setSaving(false);

    if (res.error) return setErr(res.error.message);

    resetEditForm();
    await load();
  }

  async function deleteToken(id: string, symbol: string) {
    const ok = window.confirm(`Token wirklich löschen? (${symbol})`);
    if (!ok) return;

    setErr(null);
    const res = await supabase.from("tokens").delete().eq("id", id);
    if (res.error) return setErr(res.error.message);

    setOpenEntry((p) => ({ ...p, [id]: false }));
    setEntryErr((p) => ({ ...p, [id]: null }));
    setOpenFgi((p) => ({ ...p, [id]: false }));
    setFgiErr((p) => ({ ...p, [id]: null }));
    setFgiData((p) => ({ ...p, [id]: null }));
    setEditingId((cur) => (cur === id ? null : cur));

    await load();
  }

  function toggleEntry(id: string) {
    setOpenEntry((p) => ({ ...p, [id]: !p[id] }));
    setEntryErr((p) => ({ ...p, [id]: null }));
  }

  function toggleFgi(id: string) {
    setOpenFgi((p) => ({ ...p, [id]: !p[id] }));
    setFgiErr((p) => ({ ...p, [id]: null }));
  }

  async function recalcEntries(t: TokenRow) {
    const id = t.id;
    const sym = String(t.symbol ?? "").trim().toUpperCase();
    if (!sym) return;

    setEntryBusy((p) => ({ ...p, [id]: true }));
    setEntryErr((p) => ({ ...p, [id]: null }));

    try {
      const { data: session } = await supabase.auth.getSession();
      const jwt = session?.session?.access_token;

      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/cmc-entry-cmc`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ symbol: sym, lookbackDays: 90, force: true }),
      });

      const j = (await res.json().catch(() => ({}))) as EntryApiResponse;

      if (!res.ok || !j?.ok) {
        const msg = j?.error ? String(j.error) : `HTTP ${res.status}`;
        setEntryErr((p) => ({ ...p, [id]: `Entry-Vorschläge Fehler: ${msg}` }));
      } else {
        await load();
      }
    } catch (e: any) {
      setEntryErr((p) => ({ ...p, [id]: `Entry-Vorschläge Fehler: ${String(e?.message ?? e)}` }));
    } finally {
      setEntryBusy((p) => ({ ...p, [id]: false }));
    }
  }

  async function adoptEntry(t: TokenRow, which: "EX1" | "EX2" | "EX3") {
    const id = t.id;
    const pick = which === "EX1" ? t.ex1_entry : which === "EX2" ? t.ex2_entry : t.ex3_entry;

    if (typeof pick !== "number" || !Number.isFinite(pick)) {
      setEntryErr((p) => ({ ...p, [id]: `${which} ist leer – erst "Neu berechnen" drücken.` }));
      return;
    }

    setEntryErr((p) => ({ ...p, [id]: null }));

    const res = await supabase.from("tokens").update({ entry_price: pick, active_entry_label: which }).eq("id", id);
    if (res.error) {
      setEntryErr((p) => ({ ...p, [id]: res.error.message }));
      return;
    }

    await load();
  }

  async function fetchFgi(id: string) {
    setFgiBusy((p) => ({ ...p, [id]: true }));
    setFgiErr((p) => ({ ...p, [id]: null }));

    try {
      const { data: session } = await supabase.auth.getSession();
      const jwt = session?.session?.access_token;

      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/cmc-fgi`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({}),
      });

      const j = (await res.json().catch(() => ({}))) as FgiApiResponse;

      if (!res.ok) return setFgiErr((p) => ({ ...p, [id]: `FGI Fehler: HTTP ${res.status}` }));
      if (j?.error) return setFgiErr((p) => ({ ...p, [id]: `FGI Fehler: ${String(j.error)}` }));

      const val = Number(j?.value);
      const cls = String(j?.classification ?? "");
      if (!Number.isFinite(val)) return setFgiErr((p) => ({ ...p, [id]: `FGI Fehler: ungültiger Wert` }));

      setFgiData((p) => ({ ...p, [id]: { value: val, classification: cls } }));
    } catch (e: any) {
      setFgiErr((p) => ({ ...p, [id]: `FGI Fehler: ${String(e?.message ?? e)}` }));
    } finally {
      setFgiBusy((p) => ({ ...p, [id]: false }));
    }
  }

  const sorted = useMemo(() => {
    return [...tokens].sort((a, b) =>
      String(a.symbol ?? "").localeCompare(String(b.symbol ?? ""), undefined, { sensitivity: "base" })
    );
  }, [tokens]);

  function jumpToToken(id: string) {
    setOpenTokenList(false);
    setTimeout(() => {
      const el = cardRefs.current[id];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setFlashId(id);
        window.setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 900);
      }
    }, 0);
  }

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <div style={S.top}>
          <div>
            <h1 style={S.title}>Invest Dashboard</h1>
            <div style={S.sub}>Tokens, Live-Kurse (last_price) + deine Werte</div>
          </div>

          <div style={S.row}>
            <button style={S.btnMid} onClick={() => setOpenTokenList(true)}>TOKENS</button>
            <button style={S.btnPrimary} onClick={startAdd}>Token erfassen</button>
            <button style={S.btnMid} onClick={() => router.push("/explore")}>Explore</button>

            <button style={S.btnDark} onClick={refreshPricesAndReload}>Reload</button>
            <button style={S.btnDark} onClick={logout}>Logout</button>
          </div>
        </div>

        {err && <div style={S.errTop}>{err}</div>}
        {loading && <div style={{ color: "#cbd5e1", marginTop: 16, fontWeight: 900 }}>Lade…</div>}

        {!loading && !sorted.length && (
          <div style={{ color: "#cbd5e1", marginTop: 16, fontWeight: 900 }}>Keine Tokens vorhanden.</div>
        )}

        <div style={S.grid}>
          {sorted.map((t) => {
            const live = typeof t.last_price === "number" ? t.last_price : null;
            const bb = typeof t.best_buy_price === "number" ? t.best_buy_price : null;

            const pctAktuell = live != null && bb != null && bb !== 0 ? ((live - bb) / bb) * 100 : null;
            const pctColor = pctAktuell == null ? "#e2e8f0" : pctAktuell >= 0 ? "#22c55e" : "#ef4444";

            const isEntryOpen = !!openEntry[t.id];
            const isFgiOpen = !!openFgi[t.id];

            const fgi = fgiData[t.id] ?? null;
            const investInfo = fgi ? fgiLabelAndInvestPct(fgi.value, fgi.classification) : null;

            const isFlash = flashId === t.id;

            return (
              <div
                key={t.id}
                style={{ ...S.card, ...(isFlash ? S.cardFlash : null) }}
                ref={(el) => { cardRefs.current[t.id] = el; }}
              >
                <div style={S.symbol}>{t.symbol}</div>

                <div style={{ ...S.headRow, marginTop: 10 }}>
                  <div style={S.dot} />
                  <div style={S.ok}>OK</div>
                </div>

                <div style={S.kv}>
                  <div><span style={S.k}>Live:</span> <span style={S.v}>{fmtSmart(t.last_price)}</span></div>

                  <div>
                    <span style={S.k}>Durchschnitt:</span>{" "}
                    <span style={S.v}>{t.avg_price == null ? "-" : fmtFixed(t.avg_price, 8)}</span>
                  </div>

                  <div style={S.strongLine}>
                    Entry (aktiv):{" "}
                    <span style={{ fontWeight: 900 }}>{t.entry_price == null ? "-" : fmtFixed(t.entry_price, 8)}</span>{" "}
                    <span style={{ color: "#93a4be", fontWeight: 900 }}>
                      {t.active_entry_label ? `(${t.active_entry_label})` : ""}
                    </span>
                  </div>

                  <div>
                    <span style={S.k}>Best Buy:</span>{" "}
                    <span style={S.v}>{t.best_buy_price == null ? "-" : fmtFixed(t.best_buy_price, 8)}</span>
                  </div>

                  <div>
                    <span style={S.k}>% aktuell:</span>{" "}
                    <span style={{ fontWeight: 900, color: pctColor }}>
                      {pctAktuell == null ? "-" : fmtPctSigned(pctAktuell, 2)}
                    </span>
                  </div>

                  <div><span style={S.k}>Exit 1:</span> <span style={S.v}>{t.exit1_pct == null ? "-" : fmtPctSigned(t.exit1_pct, 2)}</span></div>
                  <div><span style={S.k}>Trend:</span> <span style={S.v}>{t.trend ?? "-"}</span></div>
                </div>

                <div style={S.divider} />

                {isFgiOpen && (
                  <div style={S.fgiBox}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                      <h3 style={S.fgiTitle}>FGI</h3>
                      <button style={S.btnMid} disabled={!!fgiBusy[t.id]} onClick={() => fetchFgi(t.id)}>
                        {fgiBusy[t.id] ? "Lade…" : "Aktualisieren"}
                      </button>
                    </div>

                    {(fgiErr[t.id] || null) && <div style={S.entryErr}>{fgiErr[t.id]}</div>}

                    {fgi && investInfo && (
                      <div style={S.fgiRow}>
                        <div><span style={S.k}>Fear &amp; Greed Index:</span> <span style={S.fgiValue}>{Math.round(fgi.value)}</span></div>
                        <div><span style={S.k}>Phase:</span> <span style={{ fontWeight: 900, color: investInfo.color }}>{investInfo.phase}</span></div>
                        <div><span style={S.k}>Invest (Empfehlung):</span> <span style={{ fontWeight: 900, color: investInfo.color }}>{investInfo.investText}</span></div>
                      </div>
                    )}
                  </div>
                )}

                {isEntryOpen && (
                  <div style={S.entryBox}>
                    <div style={S.entryTitleRow}>
                      <h3 style={S.entryTitle}>Entry-Vorschläge</h3>
                      <button style={S.entryRecalcBtn} disabled={!!entryBusy[t.id]} onClick={() => recalcEntries(t)}>
                        {entryBusy[t.id] ? "Berechne…" : "Neu berechnen"}
                      </button>
                    </div>

                    {(entryErr[t.id] || null) && <div style={S.entryErr}>{entryErr[t.id]}</div>}

                    <div style={S.entryList}>
                      {(["EX1", "EX2", "EX3"] as const).map((name) => {
                        const price = name === "EX1" ? t.ex1_entry : name === "EX2" ? t.ex2_entry : t.ex3_entry;
                        const pct = name === "EX1" ? t.ex1_pct : name === "EX2" ? t.ex2_pct : t.ex3_pct;

                        return (
                          <div key={name} style={S.entryRow}>
                            <div style={S.entryName}>{name}:</div>
                            <div style={S.entryVal}>
                              {price == null ? "-" : fmtSmart(price)}{" "}
                              <span style={S.entryPct}>{pct == null ? "" : `(${fmtPctSigned(-Math.abs(pct), 2)})`}</span>
                            </div>
                            <button style={S.entryUseBtn} onClick={() => adoptEntry(t, name)}>Übernehmen</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div style={S.btnGrid}>
                  <button
                    style={{ ...S.btnMid, ...S.btnFull }}
                    disabled={!!fgiBusy[t.id]}
                    onClick={async () => {
                      toggleFgi(t.id);
                      const willOpen = !openFgi[t.id];
                      if (willOpen && !fgiData[t.id]) await fetchFgi(t.id);
                    }}
                  >
                    {fgiBusy[t.id] ? "FGI…" : isFgiOpen ? "FGI schließen" : "FGI"}
                  </button>

                  <button style={{ ...S.btnPrimary, ...S.btnFull }} onClick={() => startEditInline(t)}>Bearbeiten</button>
                  <button style={{ ...S.btnMid, ...S.btnFull }} onClick={() => toggleEntry(t.id)}>
                    {isEntryOpen ? "Entry-Vorschläge schließen" : "Entry-Vorschläge"}
                  </button>
                  <button style={{ ...S.btnDanger, ...S.btnFull }} onClick={() => deleteToken(t.id, t.symbol)}>Löschen</button>
                </div>

                {editingId === t.id && (
                  <div style={S.formCard}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <h2 style={S.formTitle}>Token bearbeiten</h2>
                      <div style={S.row}>
                        <button style={S.btnDark} onClick={() => resetEditForm()}>Schließen</button>
                      </div>
                    </div>

                    <div style={S.label}>Symbol (z.B. BTC)</div>
                    <input style={S.input} value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="BTC" />

                    <div style={S.label}>Durchschnitt (Info)</div>
                    <input style={S.input} value={avg} onChange={(e) => setAvg(e.target.value)} placeholder="0.12345678" inputMode="decimal" />

                    <div style={S.label}>Entry (aktiv) manuell</div>
                    <input style={S.input} value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="0.05000000" inputMode="decimal" />

                    <div style={S.label}>Best Buy</div>
                    <input style={S.input} value={bestBuy} onChange={(e) => setBestBuy(e.target.value)} placeholder="0.04500000" inputMode="decimal" />

                    <div style={S.label}>Exit 1 in % (z.B. 25 für +25%)</div>
                    <input style={S.input} value={exit1} onChange={(e) => setExit1(e.target.value)} placeholder="25" />

                    <div style={{ ...S.row, marginTop: 12 }}>
                      <button style={S.btnPrimary} disabled={saving} onClick={saveTokenInline}>
                        {saving ? "Speichern…" : "Speichern"}
                      </button>
                      <button style={S.btnMid} disabled={saving} onClick={() => resetEditForm()}>
                        Abbrechen
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {openTokenList && (
          <div style={S.overlay} onClick={() => setOpenTokenList(false)}>
            <div style={S.overlayCard} onClick={(e) => e.stopPropagation()}>
              <div style={S.overlayTitleRow}>
                <h3 style={S.overlayTitle}>TOKENS</h3>
                <button style={S.btnDark} onClick={() => setOpenTokenList(false)}>Schließen</button>
              </div>

              <div style={S.tokenList}>
  {sorted.map((t) => {
    const live = typeof t.last_price === "number" ? t.last_price : null;
    const bb = typeof t.best_buy_price === "number" ? t.best_buy_price : null;

    const pct =
      live != null && bb != null && bb !== 0 ? ((live - bb) / bb) * 100 : null;

    const pctColor =
      pct == null ? "#94a3b8" : pct >= 0 ? "#22c55e" : "#ef4444";

    return (
      <button
        key={t.id}
        style={S.tokenItemBtn}
        onClick={() => jumpToToken(t.id)}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontWeight: 900 }}>{t.symbol}</div>

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ color: "#cbd5e1", fontWeight: 900 }}>
              {live == null ? "-" : fmtSmart(live)}
            </div>

            <div style={{ color: "#94a3b8", fontWeight: 900 }}>
              BB {bb == null ? "-" : fmtFixed(bb, 8)}
            </div>

            <div style={{ color: pctColor, fontWeight: 900, minWidth: 72, textAlign: "right" }}>
              {pct == null ? "-" : fmtPctSigned(pct, 2)}
            </div>
          </div>
        </div>
      </button>
    );
  })}
</div>

            </div>
          </div>
        )}
      </div>
    </div>
  );
}
