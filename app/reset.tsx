import React, { useEffect, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { supabase } from "../lib/supabase";

export default function ResetPasswordScreen() {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  // Wenn der User über den Mail-Link kommt, setzt Supabase intern eine Session.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setReady(!!data.session);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setReady(!!s);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const save = async () => {
    const a = pw1.trim();
    const b = pw2.trim();

    if (a.length < 6) return Alert.alert("Fehler", "Passwort zu kurz (min. 6 Zeichen).");
    if (a !== b) return Alert.alert("Fehler", "Passwörter stimmen nicht überein.");
    if (!ready) return Alert.alert("Fehler", "Reset-Link ungültig/abgelaufen. Bitte erneut anfordern.");

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: a });
    setBusy(false);

    if (error) return Alert.alert("Fehler", error.message);

    Alert.alert("Erfolg", "Passwort geändert. Du kannst dich jetzt einloggen.");
    // Session optional beenden:
    await supabase.auth.signOut();
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#0b0f14", padding: 24, paddingTop: 80, gap: 12 }}>
      <Text style={{ color: "white", fontSize: 26, fontWeight: "900" }}>Neues Passwort</Text>

      <Text style={{ color: "#94a3b8" }}>
        Öffne diesen Screen nur über den Link aus der Reset-Mail.
      </Text>

      <TextInput
        placeholder="Neues Passwort"
        placeholderTextColor="#94a3b8"
        value={pw1}
        onChangeText={setPw1}
        secureTextEntry
        style={{
          borderWidth: 1,
          borderColor: "#334155",
          borderRadius: 14,
          padding: 14,
          color: "white",
          backgroundColor: "#0b0f14",
        }}
      />

      <TextInput
        placeholder="Neues Passwort wiederholen"
        placeholderTextColor="#94a3b8"
        value={pw2}
        onChangeText={setPw2}
        secureTextEntry
        style={{
          borderWidth: 1,
          borderColor: "#334155",
          borderRadius: 14,
          padding: 14,
          color: "white",
          backgroundColor: "#0b0f14",
        }}
      />

      <Pressable
        onPress={save}
        disabled={busy}
        style={{
          padding: 14,
          borderRadius: 14,
          backgroundColor: busy ? "#334155" : "#2563eb",
        }}
      >
        <Text style={{ color: "white", textAlign: "center", fontWeight: "900" }}>
          {busy ? "..." : "Passwort speichern"}
        </Text>
      </Pressable>
    </View>
  );
}
