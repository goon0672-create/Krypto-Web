"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import PushButton from "@/components/PushButton";

export default function ExplorePage() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);

  // ===== PUSH PREFS =====
  const [exitNearPct, setExitNearPct] = useState("45");
  const [prefsBusy, setPrefsBusy] = useState(false);

  // ===== CMC KEY =====
  const [cmcKey, setCmcKey] = useState("");
  const [cmcBusy, setCmcBusy] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [editingKey, setEditingKey] = useState(false);

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
    label: { color: "#cbd5e1", marginTop: 6 },
    input: {
      width: "100%",
      boxSizing: "border-box", // ✅ wichtig – verhindert Überstehen
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
      padding: "10px 14px",
      borderRadius: 999,
      background: "#111827",
      color: "white",
      border: "1px solid #1f2937",
      cursor: "pointer",
      fontWeight: 900,
    },
    ok: { color: "#22c55e", fontWeight: 900, fontSize: 16, marginTop: 10 },
    warn: { color: "#fbbf24", fontWeight: 900, fontSize: 16, marginTop: 10 },
    err: { color: "tomato", marginTop: 10, fontWeight: 800 },
  };

  // ===== LOAD PUSH PREFS =====
  async function loadPushPrefs() {
    setErr(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      router.replace("/login");
      return;
    }

    const { data } = await supabase
      .from("push_prefs")
      .select("exit_near_pct")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (data?.exit_near_pct != null) {
      setExitNearPct(String(data.exit_near_pct));
    }
  }

  async function savePushPrefs() {
    const v = Number(exitNearPct);
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      setErr("Bitte einen Wert zwischen 0 und 100 eingeben.");
      return;
    }

    setPrefsBusy(true);
    setErr(null);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      router.replace("/login");
      return;
    }

    const { error } = await supabase.from("push_prefs").upsert(
      {
        user_id: auth.user.id,
        exit_near_pct: v,
      },
      { onConflict: "user_id" }
    );

    setPrefsBusy(false);
    if (error) setErr(error.message);
  }

  // ===== LOAD CMC STATUS =====
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

    const { error } = await supabase.from("user_api_keys").upsert(
      { user_id: auth.user.id, cmc_api_key: key },
      { onConflict: "user_id" }
    );

    setCmcBusy(false);
    if (error) return setErr(error.message);

    setCmcKey("");
    setEditingKey(false);
    loadCmcStatus();
  }

  useEffect(() => {
    loadPushPrefs();
    loadCmcStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={S.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={S.title}>Explore</h1>
        <button style={S.btnDark} onClick={() => router.push("/dashboard")}>
          Zurück
        </button>
      </div>

      {err && <div style={S.err}>{err}</div>}

      {/* PUSH AKTIVIEREN */}
      <div style={S.card}>
        <div style={{ color: "white", fontSize: 18, fontWeight: 900 }}>
          Push Benachrichtigungen
        </div>
        <div style={S.label}>
          Aktiviert Push für dieses Gerät (Android / iPhone / Desktop).
        </div>
        <div style={{ marginTop: 12 }}>
          <PushButton label="Push aktivieren" />
        </div>
      </div>

      {/* PUSH SCHWELLE */}
      <div style={S.card}>
        <div style={{ color: "white", fontSize: 18, fontWeight: 900 }}>
          Push Schwelle: Exit 1 „fast erreicht“
        </div>
        <div style={S.label}>
          Abstand in % unter deinem Exit-1-Ziel.
        </div>

        <input
          style={{ ...S.input, marginTop: 12 }}
          value={exitNearPct}
          onChange={(e) => setExitNearPct(e.target.value)}
          inputMode="numeric"
          placeholder="z.B. 45"
        />

        <div style={S.row}>
          {[10, 20, 30, 45].map((x) => (
            <button
              key={x}
              style={S.btnPill}
              onClick={() => setExitNearPct(String(x))}
            >
              {x}%
            </button>
          ))}

          <button style={S.btnPrimary} disabled={prefsBusy} onClick={savePushPrefs}>
            {prefsBusy ? "Speichern…" : "Speichern"}
          </button>
        </div>
      </div>

      {/* CMC API KEY */}
      <div style={S.card}>
        <div style={{ color: "white", fontSize: 18, fontWeight: 900 }}>
          CoinMarketCap API Key
        </div>

        {hasKey === null && <div style={S.label}>Lade…</div>}

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
