"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function subscribe(employeeId: string) {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
    ),
  });
  const json = sub.toJSON();
  const supabase = supabaseBrowser();
  await supabase.from("push_subscriptions").upsert(
    {
      employee_id: employeeId,
      endpoint: sub.endpoint,
      p256dh: json.keys!.p256dh,
      auth: json.keys!.auth,
    },
    { onConflict: "endpoint" }
  );
}

export default function PushSetup({ employeeId }: { employeeId: string }) {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js");
    if (!("Notification" in window) || !("PushManager" in window)) return;

    if (Notification.permission === "granted") {
      subscribe(employeeId).catch(() => {});
    } else if (Notification.permission === "default") {
      setShowPrompt(true);
    }
  }, [employeeId]);

  if (!showPrompt) return null;

  return (
    <div className="fixed inset-x-4 bottom-20 z-50 rounded-xl bg-slate-900 p-4 text-white shadow-xl">
      <p className="text-sm">
        Enable notifications to get updates about approvals and your work session.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={async () => {
            setShowPrompt(false);
            const perm = await Notification.requestPermission();
            if (perm === "granted") subscribe(employeeId).catch(() => {});
          }}
          className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold"
        >
          Enable
        </button>
        <button
          onClick={() => setShowPrompt(false)}
          className="rounded-lg px-4 py-2 text-sm text-slate-300"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
