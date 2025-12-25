import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "../lib/supabase";

/* ------------------ Utils ------------------ */
const fmtPrice = (v?: number | null) =>
  typeof v === "number" ? `$${v.toFixed(6)}` : "-";

/* ------------------ Types ------------------ */
type TokenRow = {
  id: string;
  symbol: string;
  avg_price: number | null;
  entry_price: number | null;
  active_entry_label: string | null;
  live_price: number | null;
  created_at: string;
};

/* ------------------ Screen ------------------ */
export default function Index() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [busy, setBusy] = useState(false);

  // form
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("");
  const [avg, setAvg] = useState("");
  const [entry, setEntry] = useState("");

  // FGI
  const [fgiOpenId, setFgiOpenId] = useState<string | null>(null);
  const [fgiValue, setFgiValue] = useState<number | null>(null);

  /* ------------------ Auth ------------------ */
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  /* ------------------ Load Tokens ------------------ */
 const loadTokens = async () => {
  const { data, error } = await supabase
    .from("tokens")
    .select("*");

  if (error) {
    Alert.alert("Fehler", error.message);
    return;
  }

  const sorted = [...(data ?? [])].sort((a, b) =>
    a.symbol.localeCompare(b.symbol, undefined, { sensitivity: "base" })
  );

  setTokens(sorted as TokenRow[]);
};




  /* ------------------ CRUD ------------------ */
  const clearForm = () => {
    setEditingId(null);
    setSymbol("");
    setAvg("");
    setEntry("");
    setShowAddForm(false);
  };

  const startEdit = (t: TokenRow) => {
    setEditingId(t.id);
    setSymbol(t.symbol);
    setAvg(t.avg_price?.toString() ?? "");
    setEntry(t.entry_price?.toString() ?? "");
    setShowAddForm(true);
  };

  const addOrUpdate = async () => {
    if (!symbol.trim()) {
      Alert.alert("Fehler", "Token fehlt");
      return;
    }

    setBusy(true);

    const payload: any = {
      symbol: symbol.trim().toUpperCase(),
      avg_price: avg ? Number(avg.replace(",", ".")) : null,
      entry_price: entry ? Number(entry.replace(",", ".")) : null,
    };

    if (payload.entry_price != null) {
      payload.active_entry_label = "MANUELL";
    }

    let res;
    if (editingId) {
      res = await supabase
        .from("tokens")
        .update(payload)
        .eq("id", editingId);
    } else {
      res = await supabase.from("tokens").insert(payload);
    }

    setBusy(false);

    if (res.error) {
      Alert.alert("Fehler", res.error.message);
      return;
    }

    clearForm();
    loadTokens();
  };

  const removeToken = async (id: string) => {
    Alert.alert("Löschen?", "Eintrag wirklich löschen?", [
      { text: "Abbrechen" },
      {
        text: "Löschen",
        style: "destructive",
        onPress: async () => {
          await supabase.from("tokens").delete().eq("id", id);
          loadTokens();
        },
      },
    ]);
  };

  /* ------------------ FGI Check ------------------ */
  const checkEntryFGI = async (t: TokenRow) => {
    try {
      const { data, error } = await supabase.functions.invoke("fgi-check", {
        body: { symbol: t.symbol },
      });
      if (error) throw error;
      setFgiValue(data.value);
      setFgiOpenId(t.id);
    } catch (e: any) {
      Alert.alert("FGI Fehler", e.message ?? "Edge Function Fehler");
    }
  };

  /* ------------------ UI ------------------ */
  if (loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!session) {
    return (
      <View style={S.center}>
        <Text style={{ color: "#fff" }}>Bitte einloggen…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={S.page} contentContainerStyle={{ padding: 16 }}>
      <Text style={S.title}>Invest Dashboard</Text>

      {/* Toggle Button */}
      <Pressable
        onPress={() => setShowAddForm((v) => !v)}
        style={S.btnMid}
      >
        <Text style={S.ctaText}>
          {showAddForm ? "TOKEN erfassen schließen" : "TOKEN erfassen"}
        </Text>
      </Pressable>

      {/* Form */}
      {showAddForm && (
        <View style={{ gap: 10, marginTop: 10 }}>
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

          <Pressable
            onPress={addOrUpdate}
            disabled={busy}
            style={S.btnPrimary}
          >
            <Text style={S.ctaText}>
              {editingId ? "Speichern" : "Hinzufügen"}
            </Text>
          </Pressable>

          {editingId && (
            <Pressable onPress={clearForm} style={S.btnMid}>
              <Text style={S.ctaText}>Abbrechen</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Tokens */}
      <View style={{ marginTop: 20, gap: 14 }}>
        {tokens.map((t) => {
          const live = t.live_price;

          const entryReached =
            typeof live === "number" &&
            typeof t.entry_price === "number" &&
            t.entry_price <= live;

          return (
            <View key={t.id} style={S.card}>
              <Text style={S.token}>{t.symbol}</Text>

              <Text style={S.text}>Live: {fmtPrice(live)}</Text>

              <Text
                style={{
                  color: entryReached ? "#22c55e" : "#cbd5e1",
                  fontWeight: "800",
                }}
              >
                Entry (aktiv): {t.active_entry_label ?? "-"} @{" "}
                {fmtPrice(t.entry_price)}
              </Text>

              <Pressable
                onPress={() =>
                  fgiOpenId === t.id
                    ? setFgiOpenId(null)
                    : checkEntryFGI(t)
                }
                style={S.btnMid}
              >
                <Text style={S.ctaText}>Entry prüfen (FGI)</Text>
              </Pressable>

              {fgiOpenId === t.id && (
                <Text style={{ color: "#facc15" }}>
                  Fear & Greed Index: {fgiValue}
                </Text>
              )}

              <Pressable onPress={() => startEdit(t)} style={S.btnPrimary}>
                <Text style={S.ctaText}>Bearbeiten</Text>
              </Pressable>

              <Pressable
                onPress={() => removeToken(t.id)}
                style={S.btnDanger}
              >
                <Text style={S.ctaText}>Löschen</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

/* ------------------ Styles ------------------ */
const S: any = {
  page: { backgroundColor: "#020617" },
  center: {
    flex: 1,
    backgroundColor: "#020617",
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#fff",
    marginBottom: 12,
  },
  input: {
    backgroundColor: "#020617",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    color: "#fff",
  },
  card: {
    backgroundColor: "#020617",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  token: { fontSize: 20, fontWeight: "800", color: "#fff" },
  text: { color: "#cbd5e1" },
  btnPrimary: {
    backgroundColor: "#2563eb",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  btnMid: {
    backgroundColor: "#0f172a",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  btnDanger: {
    backgroundColor: "#7f1d1d",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  ctaText: { color: "#fff", fontWeight: "700" },
};
