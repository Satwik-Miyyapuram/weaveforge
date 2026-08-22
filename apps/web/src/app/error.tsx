"use client";

import { resetAppData } from "@/lib/client-runtime-recovery";
import { errorDetail, useLoggedError, type ErrorBoundaryProps } from "./error-boundary-parts";

/**
 * Route error UI — replaces Next’s opaque “Application error” page when a
 * route boundary catches. Reset clears SW + local data (needed on Android TWA;
 * Clear cache alone is often not enough).
 */
export default function Error({ error, reset }: ErrorBoundaryProps) {
  useLoggedError(error);

  return (
    <main className="app-shell" style={{ padding: 24, maxWidth: 480, margin: "10vh auto" }}>
      <h1 style={{ fontSize: "1.25rem", marginBottom: 8 }}>Something went wrong</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        On Android, Clear cache is often not enough — use Reset app data below, or
        Settings → Apps → WeaveForge → Storage → Clear storage.
      </p>
      {errorDetail(error) ? (
        <pre
          className="muted"
          style={{
            whiteSpace: "pre-wrap",
            fontSize: "0.8rem",
            marginBottom: 16,
            maxHeight: 160,
            overflow: "auto",
          }}
        >
          {errorDetail(error)}
        </pre>
      ) : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn-primary" onClick={() => reset()}>
          Try again
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={resetAppData}
        >
          Reset app data
        </button>
      </div>
    </main>
  );
}
