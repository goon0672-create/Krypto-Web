import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "../../lib/supabase";

type PushMode = "off" | "daily" | "multi";

export default function Explore() {
  // ===== CMC KEY =====
  const [cmcKey, setCmcKey] = useState("");
  const [cmcBusy, setCmcBusy] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [editingKey, setEditingKey] = useState(false);

  // ===== PUSH PREFS =====
  const [pushMode, setPushMode] = useState<PushMode>("off");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushModal, setPushModal] = useState(false);

  const S = {
    page: { flex: 1, backgroundColor: "#0b0f14", padding: 24, paddingTop: 60, gap: 16 },
    title: { color: "white", fontSize: 26, fontWeight: "900" as const },
    card: {
      borderWidth: 1,
      borderColor: "#334155",
      borderRadius: 16,
      padding: 16,
      gap: 12,
      backgroundColor: "#0b0f14",
    },
    label: { color: "#cbd5e1" },
    input: {
      borderWidth: 1,
      borderColor: "#334155",
      borderRadius: 14,
      padding: 14,
      color: "white",
      backgroundColor: "#0b0f14",
    },
    btnPrimary: { padding: 14, borderRadius: 14, backgroundColor: "#2563eb" },
    btnDark: { padding: 14, borderRadius: 14, backgroundColor: "#111827" },
    btnMid: { padding: 14, borderRadius: 14, backgroundColor: "#1f2937" },
    cta: { color: "white", textAlign: "center" as const, fontWeight: "900" as const },
    ok: { color: "#22c55e", fontWeight: "900" as const, fontSize: 16 },
    warn: { color: "#fbbf24", fontWeight: "900" as const, fontSize: 16 },
  };

  /* =========================
     Load CMC key status + push mode
  ========================= */

  const loadCmcStatus = async () => {
    const { data, error } = await supabase.functions.invoke("has-cmc-key");
    if (error) {
      setHasKey(false);
      return;
    }
    setHasKey(!!data?.hasKey);
  };

  const loadPushMode = async () => {
    const { data: sess } = await supabase.auth.getSession();
    const session = sess?.session;
    if (!session?.user?.id) return;

    const { data, error } = await supabase
      .from("push_prefs")
      .select("mode")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (error) return;
    if (data?.mode) setPushMode(data.mode as PushMode);
  };

  useEffect(() => {
    loadCmcStatus();
    loadPushMode();
  }, []);

  /* =========================
     Save CMC Key (Edge Function)
  ========================= */

  const saveCmcKey = async () => {
    const key = cmcKey.trim();
    if (key.length < 10) return Alert.alert("Fehler", "CMC API Key zu kurz");

    setCmcBusy(true);
    const { data, error } = await supabase.functions.invoke("save-cmc-key", {
      body: { cmcApiKey: key },
    });
    setCmcBusy(false);

    if (error) return Alert.alert("Fehler", error.message);
    if (data?.error) return Alert.alert("Fehler", data.error);

    setCmcKey("");
    setEditingKey(false);
    await loadCmcStatus();
    Alert.alert("Erfolg", "CMC API Key wurde gespeichert.");
  };

  /* =========================
     Save Push Mode (DB)
  ========================= */

  const savePushMode = async (next: PushMode) => {
    const { data: sess } = await supabase.auth.getSession();
    const session = sess?.session;
    if (!session?.user?.id) return Alert.alert("Login", "Bitte einloggen.");
console.log("ACCESS_TOKEN", sess.session?.access_token);

    setPushBusy(true);

    const { error } = await supabase
      .from("push_prefs")
      .upsert(
        {
          user_id: session.user.id,
          mode: next,
          times_per_day: next === "multi" ? 3 : 1,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    setPushBusy(false);

    if (error) return Alert.alert("Fehler", error.message);

    setPushMode(next);
    setPushModal(false);
  };

  const pushLabel = (m: PushMode) => {
    if (m === "off") return "Aus";
    if (m === "daily") return "Täglich (1x)";
    return "Mehrmals täglich";
  };

  /* =========================
     Render
  ========================= */

  return (
    <View style={S.page}>
      <Text style={S.title}>Explore</Text>

      {/* ===== PUSH SETTINGS ===== */}
      <View style={S.card}>
        <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>
          Push Benachrichtigungen
        </Text>
        <Text style={S.label}>
          Benachrichtigen, wenn Live ≤ Entry (aktiv). (Server prüft das später automatisch.)
        </Text>

        <Text style={S.label}>Aktuell: {pushLabel(pushMode)}</Text>




       <Pressable
  onPress={() => {}}
  disabled={true}
  style={{ ...S.btnPrimary, backgroundColor: "#334155" }}
>
  <Text style={S.cta}>Push Einstellungen (deaktiviert)</Text>
</Pressable>


        <Modal visible={pushModal} transparent animationType="fade" onRequestClose={() => setPushModal(false)}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 24 }}>
            <View style={{ backgroundColor: "#0b0f14", borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: "#334155" }}>
              <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>Push Häufigkeit</Text>

              <Pressable onPress={() => savePushMode("off")} disabled={pushBusy} style={S.btnDark}>
                <Text style={S.cta}>Aus</Text>
              </Pressable>

              <Pressable onPress={() => savePushMode("daily")} disabled={pushBusy} style={S.btnDark}>
                <Text style={S.cta}>Täglich (1x)</Text>
              </Pressable>

              <Pressable onPress={() => savePushMode("multi")} disabled={pushBusy} style={S.btnDark}>
                <Text style={S.cta}>Mehrmals täglich</Text>
              </Pressable>

              <Pressable onPress={() => setPushModal(false)} disabled={pushBusy} style={S.btnMid}>
                <Text style={S.cta}>Schließen</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </View>

      {/* ===== CMC KEY ===== */}
      <View style={S.card}>
        <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>
          CoinMarketCap API Key
        </Text>

        {hasKey === null && <ActivityIndicator size="large" color="#2563eb" />}

        {hasKey === true && !editingKey && (
          <>
            <Text style={S.ok}>✔ CMC API Key gespeichert</Text>
            <Text style={S.label}>Deine API wird ausschließlich serverseitig verwendet.</Text>

            <Pressable onPress={() => setEditingKey(true)} style={S.btnMid}>
              <Text style={S.cta}>API Key ändern</Text>
            </Pressable>
          </>
        )}

        {(hasKey === false || editingKey) && (
          <View style={{ gap: 10 }}>
            {hasKey === false ? (
              <Text style={S.warn}>⚠ Kein CMC Key hinterlegt</Text>
            ) : (
              <Text style={S.label}>Neuen Key einfügen:</Text>
            )}

            <TextInput
              value={cmcKey}
              onChangeText={setCmcKey}
              placeholder="CMC API Key einfügen"
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              autoCorrect={false}
              style={S.input}
            />

            <Pressable
              onPress={saveCmcKey}
              disabled={cmcBusy}
              style={{ ...S.btnPrimary, backgroundColor: cmcBusy ? "#334155" : "#2563eb" }}
            >
              <Text style={S.cta}>{cmcBusy ? "Speichern..." : "CMC Key speichern"}</Text>
            </Pressable>

            {editingKey && (
              <Pressable
                onPress={() => {
                  setEditingKey(false);
                  setCmcKey("");
                }}
                style={S.btnDark}
              >
                <Text style={S.cta}>Abbrechen</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

