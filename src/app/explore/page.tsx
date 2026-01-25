"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

function toNum(v: string): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const x = Number(s.replace(",", "."));
  return Number.isFinite(x) ? x : null;
}

export default function ExplorePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [exitNearPct, setExitNearPct] = useState<string>("45");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

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

    card: {
      marginTop: 18,
      backgroundColor: "#020617",
      border: "1px solid rgba(148,163,184,0.35)",
      borderRadius: 22,
      padding: 18,
      boxShadow: "0 0 0 1px rgba(2,6,23,0.1), 0 20px 60px rgba(0,0,0,0.35)",
    },

    h2: { color: "#fff", fontSize: 22, fontWeight: 900, margin: 0 },
    p: { color: "#94a3b8", marginTop: 8, lineHeight: 1.6 },

    label: { color: "#cbd5e1", marginTop: 14, fontWeight: 900 },
    inputRow: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" as const, marginTop: 10 },
    input: {
      width: 180,
      border: "1px solid #334155",
      borderRadius: 14,
      padding: 14,
      color: "white",
      backgroundColor: "#020617",
      outline: "none",
      fontSize: 16,
      fontWeight: 900,
    },

    hint: { color: "#94a3b8", fontWeight: 900, marginTop: 10 },
    err: { color: "tomato", fontWeight: 900, marginTop: 12 },
    ok: { color: "#22c55e", fontWeight: 900, marginTop: 12 },
    pillRow: { display: "flex", gap: 10, flexWrap: "wrap" as const, marginTop: 12 },
    pill: {
      backgroundColor: "#0f172a",
      border: "1px solid #1f2937",
      color: "#fff",
      padding: "10px 12px",
      borderRadius: 999,
      cursor: "pointer",
      fontWeight: 900,
    },
  };

  async function loadPrefs() {
    setLoading(true);
    setErr(null);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      router.replace("/login");
      return;
    }

    // push_prefs ist optional: wenn kein Row existiert -> fallback 45
    const { data, error } = await supabase
      .from("push_prefs")
      .select("exit1_near_pct")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (error) {
      setErr(error.message);
      setExitNearPct("45");
      setLoading(false);
      return;
    }

    const v = data?.exit1_near_pct;
    setExitNearPct(v != null ? String(v) : "45");
    setLoading(false);
  }

  async function savePrefs() {
    setErr(null);
    setSavedFlash(false);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      router.replace("/login");
      return;
    }

    const v = toNum(exitNearPct);
    if (v == null) {
      setErr("Bitte eine Zahl eingeben (z.B. 45).");
      return;
    }
    if (v < 0 || v > 100) {
      setErr("Bitte einen Wert zwischen 0 und 100 eingeben.");
      return;
    }

    setSaving(true);

    const res = await supabase.from("push_prefs").upsert({
      user_id: auth.user.id,
      exit1_near_pct: v,
      updated_at: new Date().toISOString(),
    });

    setSaving(false);

    if (res.error) {
      setErr(res.error.message);
      return;
    }

    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1200);
  }

  useEffect(() => {
    loadPrefs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <div style={S.top}>
          <div>
            <h1 style={S.title}>Explore</h1>
            <div style={S.sub}>Einstellungen & Tools</div>
          </div>

          <div style={S.row}>
            <button style={S.btnMid} onClick={() => router.push("/dashboard")}>
              Dashboard
            </button>
            <button style={S.btnDark} onClick={() => router.push("/dashboard")}>
              Zurück
            </button>
          </div>
        </div>

        {loading && <div style={{ color: "#cbd5e1", marginTop: 16, fontWeight: 900 }}>Lade…</div>}
        {err && <div style={S.err}>{err}</div>}

        {!loading && (
          <div style={S.card}>
            <h2 style={S.h2}>Push: Exit 1 „fast erreicht“</h2>
            <div style={S.p}>
              Stelle ein, ab welchem Abstand in % unter deinem Exit-1-Ziel du eine Benachrichtigung bekommst.
              <br />
              Beispiel: <b>45</b> bedeutet: Push kommt, sobald der Kurs innerhalb von 45% unter dem Ziel liegt.
            </div>

            <div style={S.label}>Abstand in Prozent (0–100)</div>

            <div style={S.inputRow}>
              <input
                style={S.input}
                value={exitNearPct}
                onChange={(e) => setExitNearPct(e.target.value)}
                placeholder="45"
                inputMode="decimal"
              />

              <button style={S.btnPrimary} disabled={saving} onClick={savePrefs}>
                {saving ? "Speichern…" : "Speichern"}
              </button>
            </div>

            <div style={S.hint}>
              Tipp: Typische Werte sind 10, 20, 30, 45. Je kleiner, desto später/selterner der Push.
            </div>

            <div style={S.pillRow}>
              {[10, 20, 30, 45].map((x) => (
                <button
                  key={x}
                  style={S.pill}
                  onClick={() => setExitNearPct(String(x))}
                  title="Setzt nur das Feld, speichert nicht automatisch"
                >
                  {x}%
                </button>
              ))}
            </div>

            {savedFlash && <div style={S.ok}>Gespeichert ✅</div>}
          </div>
        )}
      </div>
    </div>
  );
}
