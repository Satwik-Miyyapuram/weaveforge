"use client";

import { useEffect } from "react";
import { resetAppData } from "@/lib/client-runtime-recovery";

/** Root error boundary — shown when the layout itself crashes (TWA cold start). */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          background: "#111",
          color: "#eee",
        }}
      >
        <main style={{ padding: 24, maxWidth: 480, margin: "10vh auto" }}>
          <h1 style={{ fontSize: "1.25rem" }}>Application error</h1>
          <p style={{ opacity: 0.8 }}>
            Stale offline data on the Android app is a common cause. Tap Reset app
            data, then sign in again.
          </p>
          {error?.message ? (
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, opacity: 0.7 }}>
              {error.message}
              {error.digest ? `\ndigest: ${error.digest}` : ""}
            </pre>
          ) : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
            <button type="button" onClick={() => reset()}>
              Try again
            </button>
            <button
              type="button"
              onClick={resetAppData}
            >
              Reset app data
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
