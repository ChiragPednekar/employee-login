"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function subscribe() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
    ),
  });
  const json = sub.toJSON();
  // Goes through an RPC: a direct upsert can't take the ON CONFLICT path (there
  // is no UPDATE policy), which left a shared handset bound to whoever signed in
  // on it first. The RPC rebinds the endpoint to the current employee.
  const { error } = await supabaseBrowser().rpc("save_push_subscription", {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys!.p256dh,
    p_auth: json.keys!.auth,
  });
  if (error) throw new Error(error.message);
}

const DISMISS_KEY = "worklog_push_prompt_dismissed";

export default function PushSetup({ employeeId }: { employeeId: string }) {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js");
    if (!("Notification" in window) || !("PushManager" in window)) return;

    if (Notification.permission === "granted") {
      subscribe().catch(() => {});
    } else if (
      Notification.permission === "default" &&
      !localStorage.getItem(DISMISS_KEY)
    ) {
      setShowPrompt(true);
    }
  }, [employeeId]);

  if (!showPrompt) return null;

  return (
    <div className="fixed inset-x-4 z-30 mx-auto max-w-md rounded-xl border border-line bg-ink p-4 text-white shadow-lg sm:max-w-sm bottom-[calc(5.5rem+env(safe-area-inset-bottom))]">
      <p className="text-sm">
        Enable notifications to get updates about approvals and your work session.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={async () => {
            setShowPrompt(false);
            const perm = await Notification.requestPermission();
            if (perm === "granted") subscribe().catch(() => {});
          }}
          className="rounded-lg bg-primary-hover px-4 py-2 text-sm font-semibold"
        >
          Enable
        </button>
        <button
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, "1");
            setShowPrompt(false);
          }}
          className="rounded-lg px-4 py-2 text-sm text-slate-300"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
