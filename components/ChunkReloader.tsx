"use client";

import { useEffect } from "react";

/**
 * After a redeploy, an already-open tab still references the previous build's JS
 * chunks. Clicking a nav link to a route whose chunk it hasn't loaded yet makes
 * that fetch 404, React aborts the transition, and the click appears to do
 * nothing at all — no error, no navigation. This is especially easy to hit on a
 * PWA, where a tab can stay open across several deploys.
 *
 * Detect that specific failure and reload once so the tab picks up the current
 * build. Guarded by sessionStorage so a genuinely broken chunk can't loop.
 */
const RELOAD_KEY = "worklog:chunk-reload";

function isChunkError(value: unknown): boolean {
  const msg =
    value instanceof Error
      ? `${value.name}: ${value.message}`
      : typeof value === "string"
        ? value
        : "";
  return (
    /ChunkLoadError/i.test(msg) ||
    /Loading chunk [\w-]+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg)
  );
}

export default function ChunkReloader() {
  useEffect(() => {
    function recover(value: unknown) {
      if (!isChunkError(value)) return;
      if (sessionStorage.getItem(RELOAD_KEY)) return; // already tried once
      sessionStorage.setItem(RELOAD_KEY, "1");
      window.location.reload();
    }

    const onError = (e: ErrorEvent) => recover(e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => recover(e.reason);

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    // A successful render means the current build loaded fine — clear the guard
    // so a future deploy can recover again.
    sessionStorage.removeItem(RELOAD_KEY);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
