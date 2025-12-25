export async function sendExpoPush(
  expoPushToken: string,
  title: string,
  body: string,
  data: Record<string, any> = {}
) {
  if (!expoPushToken || !expoPushToken.startsWith("ExponentPushToken")) {
    console.error("❌ Invalid Expo push token:", expoPushToken);
    return { ok: false, error: "invalid_token" };
  }

  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: expoPushToken,
      sound: "default",
      title,
      body,
      data,
    }),
  });

  const json = await res.json().catch(async () => ({ raw: await res.text() }));
  console.log("📨 Expo Push response:", res.status, json);

  return { ok: res.ok, status: res.status, json };
}
