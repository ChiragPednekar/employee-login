"use client";

import { useEffect } from "react";
import { TriangleAlert, RotateCw } from "lucide-react";

/**
 * Without a boundary here, a render error inside an admin tab makes React
 * discard the navigation — the tab click looks like it does nothing at all.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Admin page error:", error);
  }, [error]);

  return (
    <main className="p-4">
      <div className="rounded-xl border border-line bg-white p-6">
        <p className="flex items-center gap-2 text-sm font-semibold text-danger-deep">
          <TriangleAlert size={17} />
          This page didn&apos;t load
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          Something went wrong while rendering this section. Your data is safe.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-surface-low p-3 text-xs text-ink-muted">
          {error.message}
          {error.digest ? `\n\nRef: ${error.digest}` : ""}
        </pre>
        <button
          onClick={reset}
          className="mt-4 flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          <RotateCw size={15} />
          Try again
        </button>
      </div>
    </main>
  );
}
