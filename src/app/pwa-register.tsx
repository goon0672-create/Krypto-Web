"use client";

import { useEffect } from "react";

export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Wichtig: sw.js liegt in /public => erreichbar unter /sw.js
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
