"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import PushButton from "@/components/PushButton";

type PushMode = "off" | "daily" | "multi";

export default function ExplorePage() {
  const router = useRouter();

  const [err, setErr] = useState<string | null>(null);

  // ===== CMC KEY (DB) =====
  const [cmcKey, setCmcKey] = useState("");
  const [cmcBusy, setCmcBusy] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [editingKey, setEditingKey] = useState(false);

  // ===== PUSH PREFS (DB) =====
  const [pushMode, setPushMode] = useState<PushMode>("off");
  const [pushBusy, setPushBusy] = useState(false);

  // ===== PUSH CHECK TEST =====
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkMsg, setCheckMsg] = useState<string | null>(null);

  const S: any = {
    page: { minHeight: "100vh", background: "#0b0f14", padding: 24 },
    top: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 },
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
    row: { display: "flex", gap: 8, flexWrap: "wrap" as const, marginTop: 10 },

    btnPrimary: { padding: "12px 14px", borderRadius: 14, background: "#2563eb", color: "white", border: 0, cursor: "pointer", fontWeight: 900 },
    btnMid: { padding: "12px 14px", borderRadius: 14, background: "#1f2937", color: "white", border: 0, cursor: "pointer", fontWeight: 900 },
    btnDark: { padding: "12px 14px", borderRadius: 14, background: "#111827", color: "white", border: 0, cursor: "pointer", fontWeight: 900 },

    ok: { color: "#22c55e", fontWeight: 900, fontSize: 16, marginTop: 10 },
    warn: { color: "#fbbf24", fontWeight: 900, fontSize: 16, marginTop: 10 },
    err: { color: "tomato", marginTop: 10, fontWeight: 900 },
    info: { color: "#93c5fd", marginTop: 10, fontWeight: 900 },
    small: { color: "#94a3b8", marginTop: 8, fontSize: 12, lineHeight: 1.4 },
    code: { color: "#e2e8f0", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  };

  const needEnv = () => {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!base) return "NEXT_PUBLIC_SUPABASE_URL fehlt";
    if (!anon) return "NEXT_PUBLIC_SUPABASE_ANON_KEY fehlt";
    return null;
  };

  const loadCmcStatus = async () => {
    setErr(null);
    setHasKey(null);

    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) {
      router.replace("/login");
      return;
    }

    const { data, error } = await supabase
      .from("user_api_keys")
      .select("cmc_api_key")
      .eq("user_id", uid)
      .maybeSingle();

    if (error) {
      setHasKey(false);
      setErr(`user_api_keys read error: ${error.message}`);
      return;
    }

    const k = String((data as any)?.cmc_api_key ?? "").trim();
    setHasKey(!!k);
  };

  const loadPushMode = async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) {
      router.replace("/login");
      return;
    }

    const { data, error } = await supabase
      .from("push_prefs")
      .select("mode")
      .eq("user_id", uid)
      .maybeSingle();

    if (!error && data?.mode) setPushMode(data.mode as PushMode);
  };

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) {
        router.replace("/login");
        return;
      }
      await loadCmcStatus();
      await loadPushMode();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveCmcKey = async () => {
    const key = cmcKey.trim();
    if (key.length < 10) {
      setErr("CMC API Key zu kurz");
      return;
    }

    setErr(null);
    setCmcBusy(true);

    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;

    if (!uid) {
      setCmcBusy(false);
      router.replace("/login");
      return;
    }

    const { error } = await supabase
      .from("user_api_keys")
      .upsert({ user_id: uid, cmc_api_key: key }, { onConflict: "user_id" });

    setCmcBusy(false);

    if (error) {
      setErr(`user_api_keys upsert error: ${error.message}`);
      return;
    }

    setCmcKey("");
    setEditingKey(false);
    await loadCmcStatus();
  };

  const savePushMode = async (next: PushMode) => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) {
      router.replace("/login");
      return;
    }

    setErr(null);
    setPushBusy(true);

    const { error } = await supabase
      .from("push_prefs")
      .upsert(
        {
          user_id: uid,
          mode: next,
          times_per_day: next === "multi" ? 3 : next === "daily" ? 1 : 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    setPushBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    setPushMode(next);
  };

  async function testPushCheck() {
    setErr(null);
    setCheckMsg(null);

    const envErr = needEnv();
    if (envErr) {
      setErr(`Push Fehler: ${envErr}`);
      return;
    }

    setCheckBusy(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const jwt = session?.session?.access_token;
      if (!jwt) {
        setErr("Push Fehler: Kein Login/JWT (bitte neu einloggen).");
        setCheckBusy(false);
        return;
      }

      const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const url = `${base}/functions/v1/push-check`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anon,
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ reason: "manual_test" }),
      });

      const text = await res.text();

      if (!res.ok) {
        setErr(`push-check HTTP ${res.status}: ${text.slice(0, 300)}`);
        setCheckBusy(false);
        return;
      }

      setCheckMsg(`push-check OK: ${text.slice(0, 300)}`);
    } catch (e: any) {
      setErr(`push-check Exception: ${String(e?.message ?? e)}`);
    } finally {
      setCheckBusy(false);
    }
  }

  return (
    <div style={S.page}>
      <div style={S.top}>
        <h1 style={S.title}>Explore</h1>
        <button style={S.btnDark} onClick={() => router.push("/dashboard")}>
          Zurück
        </button>
      </div>

      {err && <div style={S.err}>{err}</div>}
      {checkMsg && <div style={S.info}>{checkMsg}</div>}

      {/* PUSH */}
      <div style={S.card}>
        <div style={{ color: "white", fontSize: 18, fontWeight: 900 }}>Push Benachrichtigungen</div>
        <div style={S.label}>
          Modus wird in <code style={S.code}>push_prefs</code> gespeichert (user_id).
        </div>

        <div style={{ marginTop: 10, color: "#cbd5e1" }}>
          Aktuell: <b>{pushMode}</b>
        </div>

        <div style={S.row}>
          <button disabled={pushBusy} style={S.btnMid} onClick={() => savePushMode("off")}>
            Aus
          </button>
          <button disabled={pushBusy} style={S.btnMid} onClick={() => savePushMode("daily")}>
            Täglich (1x)
          </button>
          <button disabled={pushBusy} style={S.btnMid} onClick={() => savePushMode("multi")}>
            Mehrmals täglich
          </button>
        </div>

        <div style={{ ...S.row, marginTop: 14 }}>
          <PushButton label="Push aktivieren" />
          <button disabled={checkBusy} style={S.btnPrimary} onClick={testPushCheck}>
            {checkBusy ? "Teste…" : "Test: push-check"}
          </button>
        </div>

        <div style={S.small}>
          Erwartung: Bei <b>Test: push-check</b> muss im Network ein Request auf{" "}
          <code style={S.code}>/functions/v1/push-check</code> erscheinen. Wenn du{" "}
          <b>Failed to fetch</b> siehst, ist fast immer{" "}
          <code style={S.code}>NEXT_PUBLIC_SUPABASE_URL</code> / Server-Neustart / falscher Function-Name das Problem.
        </div>
      </div>

      {/* CMC KEY */}
      <div style={S.card}>
        <div style={{ color: "white", fontSize: 18, fontWeight: 900 }}>CoinMarketCap API Key</div>

        {hasKey === null && <div style={S.label}>Lade Status…</div>}

        {hasKey === true && !editingKey && (
          <>
            <div style={S.ok}>✔ CMC API Key gespeichert</div>
            <div style={S.label}>
              Der Key wird in <code style={S.code}>user_api_keys</code> gespeichert.
            </div>
            <div style={S.row}>
              <button style={S.btnMid} onClick={() => setEditingKey(true)}>
                API Key ändern
              </button>
              <button style={S.btnDark} onClick={loadCmcStatus}>
                Status neu laden
              </button>
            </div>
          </>
        )}

        {(hasKey === false || editingKey) && (
          <>
            {hasKey === false ? <div style={S.warn}>⚠ Kein CMC Key hinterlegt</div> : <div style={S.label}>Neuen Key einfügen:</div>}

            <div style={{ marginTop: 10 }}>
              <input
                value={cmcKey}
                onChange={(e) => setCmcKey(e.target.value)}
                placeholder="CMC API Key einfügen"
                style={S.input}
              />
            </div>

            <div style={S.row}>
              <button disabled={cmcBusy} style={S.btnPrimary} onClick={saveCmcKey}>
                {cmcBusy ? "Speichern…" : "CMC Key speichern"}
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

              <button style={S.btnDark} onClick={loadCmcStatus}>
                Status neu laden
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
