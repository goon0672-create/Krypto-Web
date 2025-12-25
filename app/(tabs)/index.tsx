import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { registerAndSavePushDevice } from "../../lib/push";
import { supabase } from "../../lib/supabase";

/* =========================
   HELPERS
========================= */

function formatErr(e: any): string {
  try {
    if (!e) return "unknown";
    if (typeof e === "string") return e;
    if (e?.message) return String(e.message);
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function formatInvokeError(err: any): string {
  try {
    if (!err) return "unknown";
    const msg = err?.message ? String(err.message) : "invoke error";
    const name = err?.name ? String(err.name) : "";
    const ctx = err?.context ? JSON.stringify(err.context) : "";
    return [name, msg, ctx].filter(Boolean).join(" | ");
  } catch {
    return String(err);
  }
}

/* =========================
   TOKEN SCREEN
========================= */

function TokenScreen({
  session,
  onLogout,
}: {
  session: any;
  onLogout: () => Promise<void>;
}) {
  const [symbol, setSymbol] = useState("");
  const [avg, setAvg] = useState("");
  const [entry, setEntry] = useState("");
  const [bestBuy, setBestBuy] = useState("");


  const [items, setItems] = useState<any[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});

  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [calcId, setCalcId] = useState<string | null>(null);

  // ✅ Eingabe-Formular Toggle (Token erfassen)
  const [showAddForm, setShowAddForm] = useState(false);

  // Toggles
  const [openAI, setOpenAI] = useState<Record<string, boolean>>({});
  const [openFGI, setOpenFGI] = useState<Record<string, boolean>>({});
  const toggleAI = (id: string) => setOpenAI((p) => ({ ...p, [id]: !p[id] }));
  const toggleFGI = (id: string) => setOpenFGI((p) => ({ ...p, [id]: !p[id] }));

  // FGI pro Token
  const [fgiState, setFgiState] = useState<
    Record<string, { value: number; classification?: string; investNowPct: any }>
  >({});

  // Push status (Info)
  const [pushReady, setPushReady] = useState<boolean>(false);
  const [pushInfo, setPushInfo] = useState<string>("");

  /* =========================
     Styles
  ========================= */

  const S = {
    input: {
      borderWidth: 1,
      borderColor: "#334155",
      borderRadius: 14,
      padding: 14,
      color: "white",
      width: "100%" as const,
      backgroundColor: "#0b0f14",
    },
    btnPrimary: {
      padding: 14,
      borderRadius: 14,
      backgroundColor: "#2563eb",
      width: "100%" as const,
    },
    btnDark: {
      padding: 14,
      borderRadius: 14,
      backgroundColor: "#111827",
      width: "100%" as const,
    },
    btnMid: {
      padding: 14,
      borderRadius: 14,
      backgroundColor: "#1f2937",
      width: "100%" as const,
    },
    card: {
      borderWidth: 1,
      borderColor: "#334155",
      borderRadius: 18,
      padding: 14,
      gap: 12,
      backgroundColor: "#0b0f14",
    },
    title: { color: "white", fontSize: 26, fontWeight: "900" as const },
    h2: { color: "white", fontSize: 18, fontWeight: "800" as const },
    label: { color: "#cbd5e1" },
    ctaText: {
      color: "white",
      textAlign: "center" as const,
      fontWeight: "900" as const,
    },
  };

  /* =========================
     Helpers
  ========================= */

  const toNum = (v: string) => {
    const x = Number(String(v).replace(",", "."));
    return Number.isFinite(x) ? x : null;
  };

  const fmtPrice = (v?: number | null) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return "-";
    return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(6)}`;
  };

  const fmtPct = (v?: number | null) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return "-";
    return `${v.toFixed(1)}%`;
  };

  const investPctFromFgi = (v: number) => {
    if (v <= 24) return 100; // Panik
    if (v <= 44) return "50-70"; // Angst
    if (v <= 55) return 25; // Neutral
    return 0; // Gier
  };

  const TrendBadge = ({ trend }: { trend?: string | null }) => {
    const t = (trend ?? "").toUpperCase();
    const isUp = t === "UP";
    const label = isUp ? "UPTREND" : "DOWNTREND";
    return (
      <View
        style={{
          alignSelf: "flex-start",
          paddingVertical: 6,
          paddingHorizontal: 10,
          borderRadius: 999,
          backgroundColor: isUp ? "#0f2f1a" : "#2b1414",
          borderWidth: 1,
          borderColor: isUp ? "#16a34a" : "#ef4444",
        }}
      >
        <Text style={{ color: "white", fontWeight: "900", fontSize: 12 }}>
          {label}
        </Text>
      </View>
    );
  };

  const EntryBox = ({
    label,
    price,
    pct,
    onAdopt,
    disabled,
  }: {
    label: string;
    price: number | null;
    pct: number | null;
    onAdopt: () => void;
    disabled?: boolean;
  }) => (
    <View
      style={{
        borderWidth: 1,
        borderColor: "#334155",
        borderRadius: 14,
        padding: 12,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: "white", fontWeight: "900" }}>{label}</Text>
        <Text style={{ color: "#cbd5e1" }}>{fmtPct(pct)}</Text>
      </View>
      <Text style={{ color: "white", fontSize: 18, fontWeight: "800" }}>
        {fmtPrice(price)}
      </Text>

      <Pressable
        onPress={onAdopt}
        disabled={disabled || price == null}
        style={{
          padding: 12,
          borderRadius: 12,
          backgroundColor: disabled || price == null ? "#334155" : "#16a34a",
        }}
      >
        <Text style={S.ctaText}>Übernehmen</Text>
      </Pressable>
    </View>
  );

  /* =========================
     PUSH REGISTER (1x)
     -> nutzt lib/push.ts
  ========================= */

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;

    (async () => {
      setPushInfo("Init...");

      const res: any = await registerAndSavePushDevice(uid);

      if (res.ok) {
        setPushReady(true);
        setPushInfo(
          `Push bereit ✅ token=${String(res.expoPushToken).slice(0, 14)}...`
        );
      } else {
        setPushReady(false);
        const detail = res.reason ? String(res.reason) : "unknown";
        setPushInfo(`Push nicht bereit: ${detail}`);
      }
    })();
  }, [session?.user?.id]);

 /* =========================
   Load Data
========================= */

const loadPrices = async (symbols: string[]) => {
  const unique = Array.from(
    new Set(symbols.map((s) => String(s ?? "").toUpperCase()))
  ).filter(Boolean);

  if (!unique.length) return;

  const { data, error } = await supabase.functions.invoke("cmc-prices", {
    body: { symbols: unique },
  });

  if (error) return;
  if (data) setPrices(data as Record<string, number>);
};

const load = async () => {
  const { data, error } = await supabase
    .from("tokens")
    .select(`
      id, created_at, user_id,
      symbol, avg_price, entry_price, active_entry_label,
      trend, suggested_week,
      ex1_entry, ex2_entry, ex3_entry,
      ex1_pct, ex2_pct, ex3_pct, best_buy_price
    `);

  if (error) {
    Alert.alert("Fehler", error.message);
    return;
  }

  // 🔑 ROBUSTE alphabetische Sortierung (case-insensitiv)
  const sorted = [...(data ?? [])].sort((a: any, b: any) =>
    String(a.symbol ?? "")
      .toUpperCase()
      .localeCompare(String(b.symbol ?? "").toUpperCase())
  );

  setItems(sorted);
  await loadPrices(sorted.map((r: any) => r.symbol));
};

useEffect(() => {
  load();
}, []);

const onPullRefresh = async () => {
  setRefreshing(true);
  await load();
  setRefreshing(false);
};


  /* =========================
     CRUD
  ========================= */

  const clearForm = () => {
    setEditingId(null);
    setSymbol("");
    setAvg("");
    setEntry("");
    setBestBuy("");
  };

  const addOrUpdate = async () => {
    const s = symbol.trim().toUpperCase();
    if (!s) return Alert.alert("Fehler", "Token fehlt");

    const avgN = avg ? toNum(avg) : null;
    const entryN = entry ? toNum(entry) : null;
    const bestBuyN = bestBuy ? toNum(bestBuy) : null;

    const payload: any = {
      symbol: s,
      avg_price: avgN,
      entry_price: entryN,
      best_buy_price: bestBuyN,
};

    if (entryN != null) payload.active_entry_label = "MANUELL";

    setBusy(true);

    const q = editingId
      ? supabase.from("tokens").update(payload).eq("id", editingId)
      : supabase.from("tokens").insert({ user_id: session.user.id, ...payload });

    const { error } = await q;
    setBusy(false);

    if (error) return Alert.alert("Fehler", error.message);

    clearForm();
    setShowAddForm(false);
    await load();
  };

  const remove = async (id: string) => {
    await supabase.from("tokens").delete().eq("id", id);
    await load();
  };

  const startEdit = (t: any) => {
    setShowAddForm(true);
    setEditingId(t.id);
    setSymbol(t.symbol ?? "");
    setAvg(t.avg_price != null ? String(t.avg_price) : "");
    setEntry(t.entry_price != null ? String(t.entry_price) : "");
    setBestBuy(t.best_buy_price != null ? String(t.best_buy_price) : "");
  };

  /* =========================
     KI / Entry / FGI
  ========================= */

  const adoptEntry = async (id: string, price: number | null, label: string) => {
    if (price == null) return;

    await supabase
      .from("tokens")
      .update({ entry_price: price, active_entry_label: label })
      .eq("id", id);

    setOpenFGI((p) => ({ ...p, [id]: false }));
    setFgiState((p) => {
      const c = { ...p };
      delete c[id];
      return c;
    });

    await load();
  };

  const recalc = async (sym: string) => {
    setCalcId(sym);
    const { error } = await supabase.functions.invoke("cmc-entry", {
      body: { symbol: sym, lookbackDays: 90, force: true },
    });
    setCalcId(null);

    if (error) Alert.alert("Fehler", "Berechnung fehlgeschlagen");
    await load();
  };

  const checkActiveEntryFGI = async (
    tokenId: string,
    live: number | null,
    activeEntry: number | null
  ) => {
    if (!live || !activeEntry) return Alert.alert("Info", "Live-Preis oder Entry fehlt");

    if (live > activeEntry) {
      setFgiState((p) => ({
        ...p,
        [tokenId]: { value: 0, investNowPct: 0, classification: "" },
      }));
      return;
    }

    const { data, error } = await supabase.functions.invoke("cmc-fgi", { body: {} });

    if (error) return Alert.alert("FGI Fehler", "Edge Function returned non-2xx");
    if (!data || (data as any).error)
      return Alert.alert("FGI Fehler", (data as any)?.error ?? "Unbekannt");

    setFgiState((p) => ({
      ...p,
      [tokenId]: {
        value: (data as any).value,
        classification: (data as any).classification,
        investNowPct: investPctFromFgi((data as any).value),
      },
    }));
  };

  /* =========================
     TEST PUSH
  ========================= */

  const testPush = async () => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const user = sess?.session?.user;
      console.log("JWT:", sess.session?.access_token);

      if (!user) return Alert.alert("Login", "Bitte einloggen.");

      const { data, error } = await supabase.functions.invoke("test-push", {
        body: { title: "Test Push", body: "Wenn du das siehst, geht Push ✅" },
      });

      if (error) return Alert.alert("Test Push", formatInvokeError(error));

      Alert.alert("Test Push", "Request gesendet. Prüfe Benachrichtigung.");
      console.log("test-push response:", data);
    } catch (e: any) {
      Alert.alert("Test Push", formatErr(e));
    }
  };

  /* =========================
     Render
  ========================= */

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#0b0f14" }}
      contentContainerStyle={{ padding: 24, paddingTop: 60, gap: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
    >
      <Text style={S.title}>Invest Dashboard</Text>

      {/* Push Status */}
      <View
        style={{
          borderWidth: 1,
          borderColor: "#334155",
          borderRadius: 14,
          padding: 12,
          backgroundColor: "#0b0f14",
        }}
      >
        <Text style={{ color: "white", fontWeight: "900" }}>
          Push: {pushReady ? "AKTIV ✅" : "NICHT AKTIV"}
        </Text>
        <Text style={{ color: "#94a3b8" }}>{pushInfo}</Text>
      </View>

     
      





      {/* Token erfassen */}
      <Pressable onPress={() => setShowAddForm((v) => !v)} style={S.btnPrimary}>
        <Text style={S.ctaText}>
          {showAddForm ? "Token erfassen schließen" : "Token erfassen"}
        </Text>
      </Pressable>

      {showAddForm && (
        <View style={{ gap: 10 }}>
          <TextInput
            placeholder="Token (z.B. BTC)"
            placeholderTextColor="#94a3b8"
            value={symbol}
            onChangeText={setSymbol}
            autoCapitalize="characters"
            style={S.input}
          />
          <TextInput
            placeholder="Durchschnitt (Info)"
            placeholderTextColor="#94a3b8"
            value={avg}
            onChangeText={setAvg}
            keyboardType="decimal-pad"
            style={S.input}
          />
          <TextInput
            placeholder="Entry (aktiv) manuell"
            placeholderTextColor="#94a3b8"
            value={entry}
            onChangeText={setEntry}
            keyboardType="decimal-pad"
            style={S.input}
          />
          <TextInput
            placeholder="Best Buy (manuell)"
            placeholderTextColor="#94a3b8"
            value={bestBuy}
            onChangeText={setBestBuy}
            keyboardType="decimal-pad"
            style={S.input}
          />

          <Pressable onPress={addOrUpdate} disabled={busy} style={S.btnPrimary}>
            <Text style={S.ctaText}>{editingId ? "Speichern" : "Hinzufügen"}</Text>
          </Pressable>

          {editingId && (
            <Pressable
              onPress={() => {
                clearForm();
                setShowAddForm(false);
              }}
              style={S.btnMid}
            >
              <Text style={S.ctaText}>Abbrechen</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Token Cards */}
      {items.map((t) => {
        const sym = String(t.symbol ?? "").toUpperCase();
        const live = prices[sym] ?? null;
        const fgi = fgiState[t.id];

        return (
          <View key={t.id} style={S.card}>
            <View style={{ gap: 8 }}>
              <TrendBadge trend={t.trend} />
              {t.suggested_week ? (
                <Text style={{ color: "#94a3b8" }}>Woche: {t.suggested_week}</Text>
              ) : null}
            </View>

            <Text style={S.h2}>{sym}</Text>

            <Text style={S.label}>Live (CMC): {fmtPrice(live)}</Text>
            <Text style={S.label}>AVG (Info): {fmtPrice(t.avg_price ?? null)}</Text>
            <Text style={S.label}>Best Buy: {fmtPrice(t.best_buy_price ?? null)}</Text>


            <Text
              style={{
                color:
                  typeof live === "number" &&
                  typeof t.entry_price === "number" &&
                  t.entry_price >= live
                    ? "#22c55e"
                    : "#cbd5e1",
                fontWeight: "800",
              }}
            >
              Entry (aktiv): {t.active_entry_label ?? "-"} @ {fmtPrice(t.entry_price ?? null)}
            </Text>

            <Pressable
              onPress={async () => {
                if (openFGI[t.id]) {
                  toggleFGI(t.id);
                  return;
                }
                toggleFGI(t.id);
                await checkActiveEntryFGI(t.id, live, t.entry_price ?? null);
              }}
              style={S.btnDark}
            >
              <Text style={S.ctaText}>
                {openFGI[t.id] ? "FGI schließen" : "Entry prüfen (FGI)"}
              </Text>
            </Pressable>

            {openFGI[t.id] && fgi && (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: "#334155",
                  borderRadius: 14,
                  padding: 12,
                  gap: 6,
                }}
              >
                <Text style={{ color: "white", fontWeight: "900" }}>
                  Fear & Greed: {fgi.value} {fgi.classification ? `(${fgi.classification})` : ""}
                </Text>
                <Text style={{ color: "white", fontWeight: "900" }}>
                  Invest jetzt: {fgi.investNowPct}%
                </Text>
                {live && t.entry_price && live > t.entry_price ? (
                  <Text style={{ color: "#94a3b8" }}>Entry noch nicht erreicht → 0%</Text>
                ) : null}
              </View>
            )}

            <Pressable onPress={() => toggleAI(t.id)} style={S.btnMid}>
              <Text style={S.ctaText}>
                {openAI[t.id] ? "KI Vorschläge ausblenden" : "KI Vorschläge"}
              </Text>
            </Pressable>

            {openAI[t.id] && (
              <View style={{ gap: 10 }}>
                <EntryBox
                  label="ENTRY 1"
                  price={t.ex1_entry ?? null}
                  pct={t.ex1_pct ?? null}
                  onAdopt={() => adoptEntry(t.id, t.ex1_entry ?? null, "ENTRY 1")}
                  disabled={busy}
                />
                <EntryBox
                  label="ENTRY 2"
                  price={t.ex2_entry ?? null}
                  pct={t.ex2_pct ?? null}
                  onAdopt={() => adoptEntry(t.id, t.ex2_entry ?? null, "ENTRY 2")}
                  disabled={busy}
                />
                <EntryBox
                  label="ENTRY 3"
                  price={t.ex3_entry ?? null}
                  pct={t.ex3_pct ?? null}
                  onAdopt={() => adoptEntry(t.id, t.ex3_entry ?? null, "ENTRY 3")}
                  disabled={busy}
                />

                <Pressable
                  onPress={() => recalc(sym)}
                  disabled={calcId === sym}
                  style={{
                    ...S.btnDark,
                    backgroundColor: calcId === sym ? "#334155" : "#111827",
                  }}
                >
                  <Text style={S.ctaText}>
                    {calcId === sym ? "..." : "Neu berechnen (nur Vorschläge)"}
                  </Text>
                </Pressable>
              </View>
            )}

            <Pressable onPress={() => startEdit(t)} style={S.btnPrimary}>
              <Text style={S.ctaText}>Bearbeiten</Text>
            </Pressable>

            <Pressable onPress={() => remove(t.id)} style={S.btnDark}>
              <Text style={S.ctaText}>Löschen</Text>
            </Pressable>
          </View>
        );
      })}

      <Pressable onPress={onLogout} style={S.btnDark}>
        <Text style={S.ctaText}>Logout</Text>
      </Pressable>
    </ScrollView>
  );
}

/* =========================
   AUTH SCREEN
========================= */

function AuthScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const inputStyle = {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 14,
    padding: 14,
    color: "white",
    width: "100%" as const,
    backgroundColor: "#0b0f14",
  };

  const onLogin = async () => {
    try {
      setBusy(true);

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        Alert.alert("Login Fehler", error.message);
        return;
      }

      if (!data?.session) {
        Alert.alert("Login", "Keine Session erhalten (unerwartet).");
        return;
      }

      Alert.alert("Login", "Erfolgreich ✅");
    } catch (e: any) {
      Alert.alert("Network/Crash", formatErr(e));
    } finally {
      setBusy(false);
    }
  };

  const onRegister = async () => {
    try {
      setBusy(true);
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) return Alert.alert("Registrieren", error.message);
      Alert.alert("Registrieren", "Account erstellt. Bitte einloggen.");
    } catch (e: any) {
      Alert.alert("Network/Crash", formatErr(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#0b0f14",
        padding: 24,
        paddingTop: 80,
        gap: 14,
      }}
    >
      <Text style={{ color: "white", fontSize: 26, fontWeight: "900" }}>Login</Text>

      <TextInput
        placeholder="E-Mail"
        placeholderTextColor="#94a3b8"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        style={inputStyle}
      />

      <TextInput
        placeholder="Passwort"
        placeholderTextColor="#94a3b8"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={inputStyle}
      />

      <Pressable
        onPress={onLogin}
        disabled={busy}
        style={{
          padding: 14,
          borderRadius: 14,
          backgroundColor: busy ? "#334155" : "#2563eb",
        }}
      >
        <Text style={{ color: "white", textAlign: "center", fontWeight: "900" }}>
          {busy ? "..." : "Login"}
        </Text>
      </Pressable>

      <Pressable
        onPress={onRegister}
        disabled={busy}
        style={{
          padding: 14,
          borderRadius: 14,
          backgroundColor: "#1f2937",
        }}
      >
        <Text style={{ color: "white", textAlign: "center", fontWeight: "900" }}>
          Registrieren
        </Text>
      </Pressable>
    </View>
  );
}

/* =========================
   ROOT
========================= */

export default function Index() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: "#0b0f14" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return session ? (
    <TokenScreen session={session} onLogout={() => supabase.auth.signOut()} />
  ) : (
    <AuthScreen />
  );
}
