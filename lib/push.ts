import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "./supabase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerAndSavePushDevice(userId: string) {
  if (!Device.isDevice) {
    return { ok: false as const, reason: "not_a_device" as const };
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    return { ok: false as const, reason: "permission_denied" as const };
  }

  const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync();

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  // 1) Device speichern (pro User genau 1 Token)
  const { error: devErr } = await supabase
    .from("push_devices")
    .upsert(
      {
        user_id: userId,
        expo_push_token: expoPushToken,
        platform: Platform.OS,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (devErr) return { ok: false as const, reason: devErr.message };

  // 2) ✅ Variante B: Default push_prefs anlegen, falls noch nicht vorhanden
  //    (dadurch ist mode NICHT mehr "off", wenn ein neuer User / neues Gerät sich registriert)
  const { error: prefErr } = await supabase
    .from("push_prefs")
    .upsert(
      {
        user_id: userId,
        mode: "multi", // default
        times_per_day: 3, // optional
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  // prefs-fehler nicht hart killen – sonst blockierst du Push-Device Registrierung
  if (prefErr) {
    console.warn("push_prefs upsert failed:", prefErr.message);
  }

  return { ok: true as const, expoPushToken };
}
