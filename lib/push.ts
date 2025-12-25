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

  // Empfehlung: pro User genau ein Token (überschreibt bei Neuinstallation)
  const { error } = await supabase
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

  if (error) return { ok: false as const, reason: error.message };

  return { ok: true as const, expoPushToken };
}
