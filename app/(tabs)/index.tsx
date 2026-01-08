import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
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
  // Add-Form (Token erfassen) - bleibt fürs Anlegen
  const [symbol, setSymbol] = useState("");
  const [avg, setAvg] = useState("");
  const [entry, setEntry] = useState("");
  const [bestBuy, setBestBuy] = useState("");
  const [exit1Pct, setExit1Pct] = useState("");

  const [items, setItems] = useState<any[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});

  // ✅ Inline Edit State (für die jeweilige Token-Card)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    avg: string;
    entry: string;
    bestBuy: string;
    exit1Pct: string;
  }>({ avg: "", entry: "", bestBuy: "", exit1Pct: "" });

  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [calcId, setCalcId] = useState<string | null>(null);

  // ✅ Eingabe-Formular Toggle (Token erfassen)
  const [showAddForm, setShowAddForm] = useState(false);

  // ✅ Token Picker Modal
  const [pickerOpen, setPickerOpen] = useState(false);

  // ✅ Scroll-to-Token
  const scrollRef = useRef<ScrollView | null>(null);
  const tokenY = useRef<Record<string, number>>({});

  const jumpToToken = (id: string) => {
    const y = tokenY.current[id];
    if (typeof y !== "number") return;
    setPickerOpen(false);

    // kleiner Delay, damit Modal sauber zu ist
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
    }, 50);
  };

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
    const { data, error } = await supabase.from("tokens").select(`
      id, created_at, user_id,
      symbol, avg_price, entry_price, active_entry_label,
      trend, suggested_week,
      ex1_entry, ex2_entry, ex3_entry,
      ex1_pct, ex2_pct, ex3_pct, best_buy_price,
      exit1_pct
    `);

    if (error) {
      Alert.alert("Fehler", error.message);
      return;
    }

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

  const clearAddForm = () => {
    setSymbol("");
    setAvg("");
    setEntry("");
    setBestBuy("");
    setExit1Pct("");
  };

  const addToken = async () => {
    const s = symbol.trim().toUpperCase();
    if (!s) return Alert.alert("Fehler", "Token fehlt");

    const avgN = avg ? toNum(avg) : null;
    const entryN = entry ? toNum(entry) : null;
    const bestBuyN = bestBuy ? toNum(bestBuy) : null;
    const exit1PctN = exit1Pct ? toNum(exit1Pct) : null;

    const payload: any = {
      symbol: s,
      avg_price: avgN,
      entry_price: entryN,
      best_buy_price: bestBuyN,
      exit1_pct: exit1PctN,
    };

    if (entryN != null) payload.active_entry_label = "MANUELL";

    setBusy(true);
    const { error } = await supabase
      .from("tokens")
      .insert({ user_id: session.user.id, ...payload });
    setBusy(false);

    if (error) return Alert.alert("Fehler", error.message);

    clearAddForm();
    setShowAddForm(false);
    await load();
  };

  const remove = async (id: string) => {
    if (editingId === id) {
      setEditingId(null);
      setEditDraft({ avg: "", entry: "", bestBuy: "", exit1Pct: "" });
    }
    await supabase.from("tokens").delete().eq("id", id);
    await load();
  };

  const startEdit = (t: any) => {
    setEditingId(t.id);
    setEditDraft({
      avg: t.avg_price != null ? String(t.avg_price) : "",
      entry: t.entry_price != null ? String(t.entry_price) : "",
      bestBuy: t.best_buy_price != null ? String(t.best_buy_price) : "",
      exit1Pct: t.exit1_pct != null ? String(t.exit1_pct) : "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft({ avg: "", entry: "", bestBuy: "", exit1Pct: "" });
  };

  const saveEdit = async (t: any) => {
    const avgN = editDraft.avg ? toNum(editDraft.avg) : null;
    const entryN = editDraft.entry ? toNum(editDraft.entry) : null;
    const bestBuyN = editDraft.bestBuy ? toNum(editDraft.bestBuy) : null;
    const exit1PctN = editDraft.exit1Pct ? toNum(editDraft.exit1Pct) : null;

    const payload: any = {
      avg_price: avgN,
      entry_price: entryN,
      best_buy_price: bestBuyN,
      exit1_pct: exit1PctN,
    };

    if (entryN != null) payload.active_entry_label = "MANUELL";
    else payload.active_entry_label = null;

    setBusy(true);
    const { error } = await supabase.from("tokens").update(payload).eq("id", t.id);
    setBusy(false);

    if (error) return Alert.alert("Fehler", error.message);

    cancelEdit();
    await load();
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
    if (!live || !activeEntry)
      return Alert.alert("Info", "Live-Preis oder Entry fehlt");

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
     Render
  ========================= */

  return (
    <ScrollView
      ref={(r) => (scrollRef.current = r)}
      style={{ flex: 1, backgroundColor: "#0b0f14" }}
      contentContainerStyle={{ padding: 24, paddingTop: 60, gap: 16 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />
      }
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


        


      {/* Token auswählen */}
      <Pressable
        onPress={() => setPickerOpen(true)}
        style={S.btnMid}
        disabled={!items.length}
      >
        <Text style={S.ctaText}>Token auswählen</Text>
      </Pressable>

      {/* Picker Modal */}
      <Modal visible={pickerOpen} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.6)",
            padding: 24,
            justifyContent: "center",
          }}
        >
          <View
            style={{
              borderWidth: 1,
              borderColor: "#334155",
              borderRadius: 18,
              padding: 14,
              backgroundColor: "#0b0f14",
              gap: 10,
              maxHeight: "80%",
            }}
          >
            <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>
              Token auswählen
            </Text>

            <ScrollView>
              {items.map((t) => {
                const sym = String(t.symbol ?? "").toUpperCase();
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => jumpToToken(t.id)}
                    style={{
                      paddingVertical: 12,
                      paddingHorizontal: 12,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: "#334155",
                      marginBottom: 10,
                      backgroundColor: "#0b0f14",
                    }}
                  >
                    <Text style={{ color: "white", fontWeight: "900" }}>{sym}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Pressable onPress={() => setPickerOpen(false)} style={S.btnDark}>
              <Text style={S.ctaText}>Schließen</Text>
            </Pressable>
          </View>
        </View>
      </Modal>








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
          <TextInput
            placeholder="Exit1 in %"
            placeholderTextColor="#94a3b8"
            value={exit1Pct}
            onChangeText={setExit1Pct}
            keyboardType="decimal-pad"
            style={S.input}
          />

          <Pressable onPress={addToken} disabled={busy} style={S.btnPrimary}>
            <Text style={S.ctaText}>{busy ? "..." : "Hinzufügen"}</Text>
          </Pressable>

          <Pressable
            onPress={() => {
              clearAddForm();
              setShowAddForm(false);
            }}
            style={S.btnMid}
          >
            <Text style={S.ctaText}>Abbrechen</Text>
          </Pressable>
        </View>
      )}

      {/* Token Cards */}
      {items.map((t) => {
        const sym = String(t.symbol ?? "").toUpperCase();
        const live = prices[sym] ?? null;
        const fgi = fgiState[t.id];

        const bb =
          typeof t.best_buy_price === "number" && Number.isFinite(t.best_buy_price)
            ? (t.best_buy_price as number)
            : null;

        let diffPct: number | null = null;
        if (bb != null && bb !== 0 && typeof live === "number" && Number.isFinite(live)) {
          diffPct = ((live - bb) / bb) * 100;
        }

        const diffColor =
          diffPct == null ? "#cbd5e1" : diffPct >= 0 ? "#22c55e" : "#ef4444";

        const exit1 =
          typeof t.exit1_pct === "number" && Number.isFinite(t.exit1_pct)
            ? (t.exit1_pct as number)
            : null;

        const isEditing = editingId === t.id;

        return (
          <View
            key={t.id}
            style={S.card}
            onLayout={(e) => {
              tokenY.current[t.id] = e.nativeEvent.layout.y;
            }}
          >
            <View style={{ gap: 8 }}>
              <TrendBadge trend={t.trend} />
              {t.suggested_week ? (
                <Text style={{ color: "#94a3b8" }}>Woche: {t.suggested_week}</Text>
              ) : null}
            </View>

            <Text style={S.h2}>{sym}</Text>

            <Text style={S.label}>Live (CMC): {fmtPrice(live)}</Text>

            {!isEditing ? (
              <>
                <Text style={S.label}>AVG (Info): {fmtPrice(t.avg_price ?? null)}</Text>
                <Text style={S.label}>Best Buy: {fmtPrice(bb)}</Text>
                <Text style={S.label}>Exit1 in %: {exit1 == null ? "-" : `${exit1}%`}</Text>
                <Text style={{ color: diffColor, fontWeight: "800" }}>
                  Abstand zu Best Buy:{" "}
                  {diffPct == null ? "-" : `${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(2)}%`}
                </Text>

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
              </>
            ) : (
              <>
                <Text style={{ color: "#94a3b8", fontWeight: "900" }}>
                  Bearbeiten (direkt hier)
                </Text>

                <TextInput
                  placeholder="AVG (Info)"
                  placeholderTextColor="#94a3b8"
                  value={editDraft.avg}
                  onChangeText={(v) => setEditDraft((p) => ({ ...p, avg: v }))}
                  keyboardType="decimal-pad"
                  style={S.input}
                />

                <TextInput
                  placeholder="Entry (aktiv) manuell"
                  placeholderTextColor="#94a3b8"
                  value={editDraft.entry}
                  onChangeText={(v) => setEditDraft((p) => ({ ...p, entry: v }))}
                  keyboardType="decimal-pad"
                  style={S.input}
                />

                <TextInput
                  placeholder="Best Buy (manuell)"
                  placeholderTextColor="#94a3b8"
                  value={editDraft.bestBuy}
                  onChangeText={(v) => setEditDraft((p) => ({ ...p, bestBuy: v }))}
                  keyboardType="decimal-pad"
                  style={S.input}
                />

                <TextInput
                  placeholder="Exit1 in %"
                  placeholderTextColor="#94a3b8"
                  value={editDraft.exit1Pct}
                  onChangeText={(v) => setEditDraft((p) => ({ ...p, exit1Pct: v }))}
                  keyboardType="decimal-pad"
                  style={S.input}
                />

                <Pressable onPress={() => saveEdit(t)} disabled={busy} style={S.btnPrimary}>
                  <Text style={S.ctaText}>{busy ? "..." : "Speichern"}</Text>
                </Pressable>

                <Pressable onPress={cancelEdit} style={S.btnMid}>
                  <Text style={S.ctaText}>Abbrechen</Text>
                </Pressable>
              </>
            )}

            <Pressable
              onPress={async () => {
                if (isEditing) return;
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
                  Fear & Greed: {fgi.value}{" "}
                  {fgi.classification ? `(${fgi.classification})` : ""}
                </Text>
                <Text style={{ color: "white", fontWeight: "900" }}>
                  Invest jetzt: {fgi.investNowPct}%
                </Text>
                {live && t.entry_price && live > t.entry_price ? (
                  <Text style={{ color: "#94a3b8" }}>Entry noch nicht erreicht → 0%</Text>
                ) : null}
              </View>
            )}

            <Pressable
              onPress={() => {
                if (isEditing) return;
                toggleAI(t.id);
              }}
              style={S.btnMid}
            >
              <Text style={S.ctaText}>
                {openAI[t.id] ? "autom. Entry-Vorschläge ausblenden" : "autom. Entry-Vorschläge"}
              </Text>
            </Pressable>

            {openAI[t.id] && !isEditing && (
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

            {!isEditing && (
              <Pressable
                onPress={() => startEdit(t)}
                style={S.btnPrimary}
                disabled={busy || (editingId != null && editingId !== t.id)}
              >
                <Text style={S.ctaText}>Bearbeiten</Text>
              </Pressable>
            )}

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
