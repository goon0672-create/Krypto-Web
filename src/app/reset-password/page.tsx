"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();

  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  const [ready, setReady] = useState(false); // Session da?
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setErr(null);
      setMsg("Prüfe Reset-Link…");

      // Supabase kann die Session async setzen (je nach Flow)
      // -> wir poll-en kurz statt sofort abzubrechen
      for (let i = 0; i < 10; i++) {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          if (!cancelled) {
            setReady(true);
            setMsg(null);
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 250));
      }

      if (!cancelled) {
        setReady(false);
        setMsg(null);
        setErr("Kein gültiger Reset-Link / keine Session. Bitte erneut Reset anfordern.");
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  async function setNewPassword() {
    setErr(null);
    setMsg(null);

    if (!ready) {
      setErr("Reset-Link ist nicht aktiv. Bitte Reset erneut anfordern.");
      return;
    }

    if (!pw1 || pw1.length < 6) {
      setErr("Passwort zu kurz (mindestens 6 Zeichen).");
      return;
    }
    if (pw1 !== pw2) {
      setErr("Passwörter stimmen nicht überein.");
      return;
    }

    setBusy(true);

    const { error } = await supabase.auth.updateUser({ password: pw1 });

    setBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    setMsg("Passwort wurde geändert. Du kannst dich jetzt einloggen.");
    setTimeout(() => router.replace("/login"), 900);
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#020617", padding: 16 }}>
      <div style={{ width: "min(520px, 100%)", border: "1px solid #334155", borderRadius: 16, padding: 16, background: "#0b1220" }}>
        <h1 style={{ color: "#fff", fontSize: 28, fontWeight: 900, margin: 0 }}>Neues Passwort</h1>

        {err && <div style={{ color: "tomato", fontWeight: 900, marginTop: 12 }}>{err}</div>}
        {msg && <div style={{ color: "#cbd5e1", fontWeight: 900, marginTop: 12 }}>{msg}</div>}
        {ready && !err && !msg && (
          <div style={{ color: "#22c55e", fontWeight: 900, marginTop: 12 }}>Reset-Link aktiv</div>
        )}

        <div style={{ marginTop: 14, color: "#cbd5e1", fontWeight: 800 }}>Neues Passwort</div>
        <input
          type="password"
          value={pw1}
          onChange={(e) => setPw1(e.target.value)}
          placeholder="••••••••"
          style={{
            width: "100%",
            marginTop: 8,
            border: "1px solid #334155",
            borderRadius: 14,
            padding: 14,
            color: "white",
            backgroundColor: "#020617",
            outline: "none",
          }}
        />

        <div style={{ marginTop: 14, color: "#cbd5e1", fontWeight: 800 }}>Wiederholen</div>
        <input
          type="password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          placeholder="••••••••"
          style={{
            width: "100%",
            marginTop: 8,
            border: "1px solid #334155",
            borderRadius: 14,
            padding: 14,
            color: "white",
            backgroundColor: "#020617",
            outline: "none",
          }}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          <button
            onClick={setNewPassword}
            disabled={busy || !ready}
            style={{
              background: busy || !ready ? "#1e3a8a" : "#2563eb",
              border: 0,
              color: "#fff",
              fontWeight: 900,
              padding: "12px 14px",
              borderRadius: 14,
              cursor: busy || !ready ? "not-allowed" : "pointer",
              opacity: busy || !ready ? 0.7 : 1,
            }}
          >
            {busy ? "…" : "Passwort setzen"}
          </button>

          <button
            onClick={() => router.replace("/login")}
            style={{ background: "#0f172a", border: "1px solid #1f2937", color: "#fff", fontWeight: 900, padding: "12px 14px", borderRadius: 14, cursor: "pointer" }}
          >
            Zurück zum Login
          </button>
        </div>
      </div>
    </div>
  );
}
