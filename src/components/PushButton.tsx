"use client";

import { ensurePushSubscription } from "@/lib/push";

export default function PushButton({
  label = "Push aktivieren",
}: {
  label?: string;
}) {
  return (
    <button
      onClick={async () => {
        try {
          await ensurePushSubscription();
          alert("Push aktiviert ✅");
        } catch (e: any) {
          alert(`Push Fehler: ${String(e?.message ?? e)}`);
        }
      }}
      style={{
        backgroundColor: "#0f172a",
        padding: "12px 16px",
        borderRadius: 14,
        color: "#fff",
        border: "1px solid #1f2937",
        cursor: "pointer",
        fontWeight: 900,
        minWidth: 160,
      }}
    >
      {label}
    </button>
  );
}
