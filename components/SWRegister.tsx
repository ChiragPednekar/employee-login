"use client";

import { useEffect } from "react";

// Registers the service worker on every page (including /login) so the app
// is installable before sign-in. Push subscription is handled by PushSetup.
export default function SWRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
