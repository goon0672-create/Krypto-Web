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

  // ===== PUSH PREFS =====
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
    hint: { color: "#94a3b8", marginTop: 10, fontWeight: 700, lineHeight: 1.5 },

    input: {
      width: "100%",
      border: "1px solid #1f2937",
      borderRadius: 12,
      padding: "12px 14px",
      color: "white",
      background: "#020617",
      outline: "none",
      fontWeight: 800,
      fontSize: 16,
    },

    row: { display: "flex", gap: 10, flexWrap: "wrap" as const, marginTop: 12 },

    btnPrimary: {
      padding: "12px 16px",
      borderRadius: 14,
      background: "#2563eb",
      color: "white",
      border: 0,
      cursor: "pointer",
      fontWeight: 900,
    },
    btnDark: {
      padding: "12px 16px",
      borderRadius: 14,
      background: "#111827",
      color: "white",
      border: "1px solid #1f2937",
      cursor: "pointer",
      fontWeight: 900,
    },
    btnPill: {
      padding: "10px 14px",
      borderRadius: 999,
      background: "#111827",
      color: "white",
      border: "1px solid #1f2937",
      cursor: "pointer",
      fontWeight: 900,
      fontSize: 14,
    },

    ok: { color: "#22c55e", fontWeight: 900, fontSize: 16, marginTop: 10 },
    warn: { color: "#fbbf24", fontWeight: 900, fontSize: 16, marginTop: 10 },
    err: { color: "tomato", marginTop: 10, fontWeight: 800 },
  };

  async function loadCmcStatus() {
    setErr(null);
    setHasKey(null);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return router.replace("/login");

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

    setHasKey(!!String(data?.cmc_api_key ?? "").trim());
  }

  async function loadPushPrefs() {
    setErr(null);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return router.replace("/login");

    const { data, error } = await supabase
      .from("push_prefs")
      .select("exit1_near_pct")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (!error && data?.exit1_near_pct != null) {
      setExitNearPct(String(data.exit1_near_pct));
    }

    setPrefsLoaded(true);
  }

  useEffect(() => {
    loadCmcStatus();
    loadPushPrefs();
  }, []);

  async function saveCmcKey() {
    const key = cmcKey.trim();
    if (key.length < 10) return setErr("CMC API Key ungültig.");

    setCmcBusy(true);
    setErr(null);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return router.replace("/login");

    const { error } = await supabase
      .from("user_api_keys")
      .upsert({ user_id: auth.user.id, cmc_api_key: key }, { onConflict: "user_id" });

    setCmcBusy(false);

    if (error) return setErr(error.message);

    setCmcKey("");
    setEditingKey(false);
    loadCmcStatus();
  }

  async function savePushPrefs() {
    setErr(null);
    setPrefsOkFlash(false);

    const v = toNum(exitNearPct);
    if (v == null || v < 0 || v > 100) {
      return setErr("Bitte einen Wert zwischen 0 und 100 eingeben.");
    }

    setPrefsBusy(true);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return router.replace("/login");

    const { error } = await supabase
      .from("push_prefs")
      .upsert(
        { user_id: auth.user.id, exit1_near_pct: v, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );

    setPrefsBusy(false);

    if (error) return setErr(error.message);

    setPrefsOkFlash(true);
    setTimeout(() => setPrefsOkFlash(false), 1200);
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

      {/* PUSH */}
      <div style={S.card}>
        <div style={{ color: "white", fontSize: 18, fontWeight: 900 }}>
          Push Benachrichtigungen
        </div>
        <div style={S.label}>Aktiviert Push für dieses Gerät.</div>
        <div style={{ marginTop: 12 }}>
          <PushButton label="Push aktivieren" />
        </div>
      </div>

      {/* PUSH PREFS */}
      <div style={S.card}>
        <div style={{ color: "white", fontSize: 18, fontWeight: 900 }}>
          Push Schwelle: Exit 1 „fast erreicht“
        </div>

        <div style={S.label}>
          Ab welchem Abstand in % unter deinem Exit-1-Ziel soll der Push kommen?
        </div>

        {prefsLoaded && (
          <>
            <div style={S.hint}>
              Beispiel: <b>45</b> → Push kommt, wenn der Kurs innerhalb von 45 % unter
              dem Exit-1-Ziel liegt.
            </div>

            <input
              style={{ ...S.input, marginTop: 12 }}
              value={exitNearPct}
              onChange={(e) => setExitNearPct(e.target.value)}
              inputMode="decimal"
            />

            <div style={S.row}>
              {[10, 20, 30, 45].map((x) => (
                <button key={x} style={S.btnPill} onClick={() => setExitNearPct(String(x))}>
                  {x}%
                </button>
              ))}

              <button style={S.btnPrimary} disabled={prefsBusy} onClick={savePushPrefs}>
                {prefsBusy ? "Speichern…" : "Speichern"}
              </button>
            </div>

            {prefsOkFlash && <div style={S.ok}>✔ gespeichert</div>}
          </>
        )}
      </div>

      {/* CMC API KEY */}
      <div style={S.card}>
        <div style={{ color: "white", fontSize: 18, fontWeight: 900 }}>
          CoinMarketCap API Key
        </div>

        {hasKey === true && !editingKey && (
          <>
            <div style={S.ok}>✔ API Key gespeichert</div>
            <div style={S.row}>
              <button style={S.btnDark} onClick={() => setEditingKey(true)}>
                Ändern
              </button>
            </div>
          </>
        )}

        {(hasKey === false || editingKey) && (
          <>
            {hasKey === false && <div style={S.warn}>⚠ Kein API Key hinterlegt</div>}

            <input
              style={S.input}
              placeholder="CMC API Key"
              value={cmcKey}
              onChange={(e) => setCmcKey(e.target.value)}
            />

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
