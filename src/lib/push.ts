import { supabase } from "@/lib/supabase";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export async function ensurePushSubscription() {
  if (typeof window === "undefined") throw new Error("client-only");
  if (!("serviceWorker" in navigator)) throw new Error("Service Worker nicht verfügbar");
  if (!("PushManager" in window)) throw new Error("Push wird nicht unterstützt (iOS: nur als Home-App)");

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
  if (!vapidPublicKey) throw new Error("NEXT_PUBLIC_VAPID_PUBLIC_KEY fehlt");

  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Push-Berechtigung abgelehnt");

  const reg = await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }

  const json = sub.toJSON();
  const endpoint = sub.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;

  if (!endpoint || !p256dh || !auth) throw new Error("Subscription unvollständig");

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) throw new Error("Nicht eingeloggt");

  const user_id = userData.user.id;

  const { error } = await supabase.from("push_subscriptions").upsert(
    { user_id, endpoint, p256dh, auth },
    { onConflict: "user_id,endpoint" }
  );

  if (error) throw new Error(error.message);

  return { ok: true, endpoint };
}
