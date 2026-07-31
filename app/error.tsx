"use client";

import { useEffect } from "react";
import { TriangleAlert, RotateCw } from "lucide-react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page error:", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-md p-6">
      <div className="rounded-xl border border-line bg-white p-6">
        <p className="flex items-center gap-2 text-sm font-semibold text-danger-deep">
          <TriangleAlert size={17} />
          Something went wrong
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
