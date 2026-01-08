"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const S: any = {
    page: {
      minHeight: "100vh",
      background: "#020617",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
      boxSizing: "border-box",
    },
    card: {
      width: "100%",
      maxWidth: 520,
      border: "1px solid #334155",
      borderRadius: 20,
      padding: 20,
      background: "rgba(255,255,255,0.03)",
      boxSizing: "border-box",
    },
    title: { color: "white", fontSize: 32, fontWeight: 900, margin: 0 },
    sub: { color: "#94a3b8", marginTop: 6, marginBottom: 20 },

    label: { color: "#cbd5e1", marginTop: 14, fontWeight: 900 },
    input: {
      width: "100%",
      marginTop: 8,
      border: "1px solid #334155",
      borderRadius: 14,
      padding: 14,
      color: "white",
      background: "#020617",
      outline: "none",
      boxSizing: "border-box",
    },

    rowBetween: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 10,
    },

    link: {
      color: "#60a5fa",
      cursor: "pointer",
      fontWeight: 900,
      fontSize: 14,
    },

    rowButtons: {
      display: "flex",
      gap: 10,
      marginTop: 18,
    },

    btnPrimary: {
      flex: 1,
      background: "#2563eb",
      padding: "14px",
      borderRadius: 14,
      color: "white",
      border: 0,
      cursor: "pointer",
      fontWeight: 900,
    },

    btnDark: {
      flex: 1,
      background: "#111827",
      padding: "14px",
      borderRadius: 14,
      color: "white",
      border: "1px solid #1f2937",
      cursor: "pointer",
      fontWeight: 900,
    },

    err: { color: "tomato", marginTop: 14, fontWeight: 900 },
  };

  async function login() {
    setErr(null);
    setBusy(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    router.replace("/dashboard");
  }

  async function register() {
    setErr(null);
    setBusy(true);

    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    setBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    setErr("Registrierung erfolgreich. Bitte E-Mail bestätigen.");
  }

  async function resetPassword() {
    if (!email.trim()) {
      setErr("Bitte zuerst E-Mail eingeben.");
      return;
    }

    setBusy(true);
    setErr(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    setErr("Passwort-Reset E-Mail wurde gesendet.");
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <h1 style={S.title}>Krypto Web</h1>
        <div style={S.sub}>Login / Registrierung</div>

        <div style={S.label}>Email</div>
        <input
          style={S.input}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@mail.com"
        />

        <div style={S.label}>Passwort</div>
        <input
          style={S.input}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="********"
        />

        <div style={S.rowBetween}>
          <span style={S.link} onClick={resetPassword}>
            Passwort vergessen?
          </span>
          <span
            style={S.link}
            onClick={() => {
              setEmail("");
              setPassword("");
              setErr(null);
            }}
          >
            Felder leeren
          </span>
        </div>

        {err && <div style={S.err}>{err}</div>}

        <div style={S.rowButtons}>
          <button style={S.btnPrimary} disabled={busy} onClick={login}>
            Login
          </button>
          <button style={S.btnDark} disabled={busy} onClick={register}>
            Registrieren
          </button>
        </div>
      </div>
    </div>
  );
}
