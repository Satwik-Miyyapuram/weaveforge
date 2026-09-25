"use client";

import { resetAppData } from "@/lib/client-runtime-recovery";
import { errorDetail, useLoggedError, type ErrorBoundaryProps } from "./error-boundary-parts";
import { ErrorReportPanel } from "./error-report-panel-lazy";

/**
 * Strictly last-resort boundary — shown when the root layout itself crashes, so
 * it replaces the whole document (stylesheets included) and cannot use the
 * app's classes.
 *
 * The ordering of the escapes deliberately matches `app/route-error.tsx`, which
 * every other boundary renders: `reset()` first, a plain reload second — that
 * one is non-destructive and is the honest answer when the failure re-throws —
 * and the data-wiping reset last, labelled for what it does and asked about
 * first. The copy no longer tells every reader to look for an Android settings
 * screen; it names that remedy only on the Android app.
 */
export default function GlobalError({ error, reset }: ErrorBoundaryProps) {
  useLoggedError(error);
  const detail = errorDetail(error);

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
          <h1 style={{ fontSize: "1.25rem" }}>WeaveForge could not start</h1>
          <p style={{ opacity: 0.8 }}>
            The app shell itself failed to load. Your work is stored outside this screen,
            so nothing has been lost. Try again, or reload the page.
          </p>
          {detail ? (
            <details style={{ marginTop: 12 }}>
              <summary style={{ opacity: 0.8 }}>Technical details</summary>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, opacity: 0.7 }}>
                {detail}
              </pre>
            </details>
          ) : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
            <button type="button" onClick={() => reset()}>
              Try again
            </button>
            <button type="button" onClick={() => window.location.reload()}>
              Reload this page
            </button>
          </div>

          {isAndroidApp() ? (
            <p style={{ opacity: 0.8, marginTop: 12 }}>
              In the installed Android app, Settings → Apps → WeaveForge → Storage → Clear
              storage fixes the stale-cache crashes this cannot.
            </p>
          ) : null}

          {/*
            The worst failure is the one most worth reporting, and this screen had
            no way to. The panel is behind the same lazy boundary as everywhere
            else — this boundary replaces the whole document, so if its own chunk
            will not load, the reader keeps the buttons above and simply does not
            see a report form. It also carries the app's inline styling problem:
            this document has no stylesheet, so the panel's classes do nothing.
            That is acceptable for a form, and the alternative — a second,
            unstyled copy of the panel — is worse.
          */}
          <ErrorReportPanel title="WeaveForge failed to start" detail={detail} />

          <section style={{ marginTop: 24, borderTop: "1px solid #444", paddingTop: 16 }}>
            <h2 style={{ fontSize: "1rem" }}>Still stuck?</h2>
            <p style={{ opacity: 0.8 }}>
              Resetting removes everything this app stored in this browser — including
              offline copies of your work — and returns to the start. Work already saved to
              your account is not affected. This cannot be undone.
            </p>
            <button
              type="button"
              style={{ color: "#ffb4a8" }}
              onClick={() => {
                // `window.confirm` is deliberate here, and this is the other
                // place that keeps it: this boundary replaces the whole
                // document, so it cannot rely on the component tree that draws
                // the app's own modal — that tree is what may have failed.
                // Everywhere else uses `components/confirm-dialog.tsx`.
                if (!window.confirm("Reset app data? Offline copies of your work on this device will be deleted. This cannot be undone.")) return;
                resetAppData();
              }}
            >
              Reset app data
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}

/**
 * Whether this is the installed Android app.
 *
 * Duplicated from `route-error.tsx` because this boundary must not import the
 * app's modules at all: it renders when the layout crashed, which is exactly
 * when reaching further into the bundle is likeliest to fail again. See that
 * file for why the tell is the `android-app://` referrer.
 */
function isAndroidApp(): boolean {
  if (typeof document === "undefined") return false;
  try {
    return document.referrer.startsWith("android-app://");
  } catch {
    return false;
  }
}
