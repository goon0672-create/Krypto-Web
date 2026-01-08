"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import PushButton from "@/components/PushButton";

export default function ExplorePage() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);

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
    ok: { color: "#22c55e", fontWeight: 900, fontSize: 16, marginTop: 10 },
    warn: { color: "#fbbf24", fontWeight: 900, fontSize: 16, marginTop: 10 },
    err: { color: "tomato", marginTop: 10, fontWeight: 800 },
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

  useEffect(() => {
    loadCmcStatus();
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
      .upsert(
        { user_id: auth.user.id, cmc_api_key: key },
        { onConflict: "user_id" }
      );

    setCmcBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    setCmcKey("");
    setEditingKey(false);
    loadCmcStatus();
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
              <button style={S.btnDark} onClick={loadCmcStatus}>
                Status neu laden
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
              <button
                style={S.btnPrimary}
                disabled={cmcBusy}
                onClick={saveCmcKey}
              >
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
