"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import PushButton from "@/components/PushButton";

function toNum(v: string): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const x = Number(s.replace(",", "."));
  return Number.isFinite(x) ? x : null;
}

export default function ExplorePage() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);

  // ===== CMC KEY =====
  const [cmcKey, setCmcKey] = useState("");
  const [cmcBusy, setCmcBusy] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [editingKey, setEditingKey] = useState(false);

  // ===== PUSH PREFS: Exit1 Near % =====
  const [exitNearPct, setExitNearPct] = useState("45");
  const [prefsBusy, setPrefsBusy] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [prefsOkFlash, setPrefsOkFlash] = useState(false);

  const S: any = {
    page: { minHeight: "100vh", background: "#0b0f14", padding: 24 },
    title: { color: "white", fontSize: 26, fontWeight: 900, margin: 0 },
    card: {
      border: "1px solid #334155",
      borderRadius: 16,
      padding: 16,
      marginTop: 16,
      background: "#0b0f14",
    },
    label: { color: "#cbd5e1" },
    input: {
      width: "100%",
      border: "1px solid #334155",
      borderRadius: 14,
      padding: 14,
      color: "white",
      background: "#0b0f14",
      outline: "none",
    },
    row: { display: "flex", gap: 10, flexWrap: "wrap" as const, marginTop: 12 },
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
      border: "1px solid #1f2937",
      cursor: "pointer",
      fontWeight: 900,
    },
    btnPill: {
      padding: "10px 12px",
      borderRadius: 999,
      background: "#111827",
      color: "white",
      border: "1px solid #1f2937",
      cursor: "pointer",
      fontWeight: 900,
      fontSize: 13,
    },
    ok: { color: "#22c55e", fontWeight: 900, fontSize: 16, marginTop: 10 },
    warn: { color: "#fbbf24", fontWeight: 900, fontSize: 16, marginTop: 10 },
    err: { color: "tomato", marginTop: 10, fontWeight: 800 },
    hint: { color: "#94a3b8", marginTop: 10, fontWeight: 800, lineHeight: 1.5 },
  };

  async function loadCmcStatus() {
    setErr(null);
    setHasKey(null);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      router.replace("/login");
      return;
    }

    const { data, error } = await supabase
      .from("user_api_keys")
      .select("cmc_api_key")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (error) {
      setErr(error.message);
      setHasKey(false);
      return;
    }

    const key = String(data?.cmc_api_key ?? "").trim();
    setHasKey(!!key);
  }

  async function loadPushPrefs() {
    setErr(null);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      router.replace("/login");
      return;
    }

    // Row kann fehlen -> fallback 45
    const { data, error } = await supabase
      .from("push_prefs")
      .select("exit1_near_pct")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (error) {
      setErr(error.message);
      setExitNearPct("45");
      setPrefsLoaded(true);
      return;
    }

    const v = data?.exit1_near_pct;
    setExitNearPct(v != null ? String(v) : "45");
    setPrefsLoaded(true);
  }

  useEffect(() => {
    loadCmcStatus();
    loadPushPrefs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveCmcKey() {
    const key = cmcKey.trim();
    if (key.length < 10) {
      setErr("CMC API Key ungültig.");
      return;
    }

    setCmcBusy(true);
    setErr(null);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      router.replace("/login");
      return;
    }

    const { error } = await supabase
      .from("user_api_keys")
      .upsert({ user_id: auth.user.id, cmc_api_key: key }, { onConflict: "user_id" });

    setCmcBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    setCmcKey("");
    setEditingKey(false);
    loadCmcStatus();
  }

  async function savePushPrefs() {
    setErr(null);
    setPrefsOkFlash(false);

    const v = toNum(exitNearPct);
    if (v == null) {
      setErr("Bitte eine Zahl für den Push-Abstand eingeben (z.B. 45).");
      return;
    }
    if (v < 0 || v > 100) {
      setErr("Push-Abstand muss zwischen 0 und 100 liegen.");
      return;
    }

    setPrefsBusy(true);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      router.replace("/login");
      return;
    }

    const { error } = await supabase
      .from("push_prefs")
      .upsert(
        { user_id: auth.user.id, exit1_near_pct: v, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );

    setPrefsBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    setPrefsOkFlash(true);
    window.setTimeout(() => setPrefsOkFlash(false), 1200);
  }

  return (
    <div style={S.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={S.title}>Explore</h1>
        <button style={S.btnDark} onClick={() => router.push("/dashboard")}>
          Zurück
        </button>
      </div>

      {err && <div style={S.err}>{err}</div>}

      {/* PUSH – nur aktivieren */}
      <div style={S.card}>
        <div style={{ color: "white", fontSize: 18, fontWeight: 900 }}>Push Benachrichtigungen</div>
        <div style={S.label}>Aktiviert Push für dieses Gerät (Android / iPhone / Desktop).</div>

        <div style={{ marginTop: 12 }}>
          <PushButton label="Push aktivieren" />
        </div>
      </div>

      {/* PUSH PREFS: Exit1 Near % */}
      <div style={S.card}>
        <div style={{ color: "white", fontSize: 18, fontWeight: 900 }}>Push Schwelle: Exit 1 „fast erreicht“</div>
        <div style={S.label}>Ab welchem Abstand in % unter deinem Exit-1-Ziel soll der Push kommen?</div>

        {!prefsLoaded && <div style={{ ...S.label, marginTop: 10 }}>Lade…</div>}

        {prefsLoaded && (
          <>
            <div style={S.hint}>
              Beispiel: <b>45</b> = Push kommt, wenn der Kurs innerhalb von 45% unter dem Exit-1-Ziel liegt. Kleinere
              Werte = später/selterner.
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ ...S.label, marginBottom: 8 }}>Abstand in % (0–100)</div>
              <input
                style={S.input}
                placeholder="45"
                value={exitNearPct}
                onChange={(e) => setExitNearPct(e.target.value)}
                inputMode="decimal"
              />
            </div>

            <div style={S.row}>
              {[10, 20, 30, 45].map((x) => (
                <button key={x} style={S.btnPill} onClick={() => setExitNearPct(String(x))}>
                  {x}%
                </button>
              ))}

              <button style={S.btnPrimary} disabled={prefsBusy} onClick={savePushPrefs}>
                {prefsBusy ? "Speichern…" : "Speichern"}
              </button>

              <button style={S.btnDark} disabled={prefsBusy} onClick={loadPushPrefs}>
                Neu laden
              </button>
            </div>

            {prefsOkFlash && <div style={S.ok}>✔ gespeichert</div>}
          </>
        )}
      </div>

      {/* CMC API KEY */}
      <div style={S.card}>
        <div style={{ color: "white", fontSize: 18, fontWeight: 900 }}>CoinMarketCap API Key</div>

        {hasKey === null && <div style={S.label}>Lade…</div>}

        {hasKey === true && !editingKey && (
          <>
            <div style={S.ok}>✔ API Key gespeichert</div>
            <div style={S.row}>
              <button style={S.btnDark} onClick={() => setEditingKey(true)}>
                Ändern
              </button>
              <button style={S.btnDark} onClick={loadCmcStatus}>
                Status neu laden
              </button>
            </div>
          </>
        )}

        {(hasKey === false || editingKey) && (
          <>
            {hasKey === false && <div style={S.warn}>⚠ Kein API Key hinterlegt</div>}

            <input style={S.input} placeholder="CMC API Key" value={cmcKey} onChange={(e) => setCmcKey(e.target.value)} />

            <div style={S.row}>
              <button style={S.btnPrimary} disabled={cmcBusy} onClick={saveCmcKey}>
                {cmcBusy ? "Speichern…" : "Speichern"}
              </button>

              {editingKey && (
                <button
                  style={S.btnDark}
                  onClick={() => {
                    setEditingKey(false);
                    setCmcKey("");
                  }}
                >
                  Abbrechen
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
