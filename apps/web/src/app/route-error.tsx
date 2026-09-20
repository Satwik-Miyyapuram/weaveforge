"use client";

import { resetAppData } from "@/lib/client-runtime-recovery";
import { errorDetail, useLoggedError, type ErrorBoundaryProps } from "./error-boundary-parts";
import { ErrorReportPanel } from "./error-report-panel-lazy";

/**
 * The body of every route error boundary.
 *
 * `app/error.tsx` catches anything no closer boundary caught, which means it is
 * also the screen a single feature's deterministic render error used to reach —
 * offering "Try again" (which re-throws the same error) or "Reset app data"
 * (which clears every `thesis.*` key and the offline caches, then reloads).
 * Neither is a proportionate answer to one broken panel, and the second is a
 * destructive action presented as the only way out.
 *
 * So the three escapes are ordered by how much they cost:
 *
 *  1. `reset()` re-renders the boundary's children. Free, and correct whenever
 *     the failure was transient (a fetch that arrived out of order, a race on
 *     first paint). It is the least destructive, so it leads.
 *  2. A plain reload of this page. Also loses nothing: the app's state is in
 *     the database, not in the tab.
 *  3. `resetAppData()`. This one *deletes data* — every local key this app
 *     wrote and every cached offline copy — so it is styled as destructive,
 *     says what it removes, and asks first. It stays reachable because on the
 *     Android app a stale service-worker precache genuinely produces a crash
 *     that only this clears.
 *
 * The copy is written for any browser. The platform-specific remedy (Settings →
 * Apps → Clear storage) is only shown where it applies, because the previous
 * wording told every desktop reader to look for an Android settings screen.
 *
 * Markup is inline-styled beyond the shared button and text classes: this
 * component is the last thing standing when a stylesheet-importing module is
 * what failed, so it depends on nothing but its two sibling files and
 * `lib/client-runtime-recovery`.
 */
export function RouteError({
  error,
  reset,
  scope,
}: ErrorBoundaryProps & {
  /** What failed, e.g. "Papers". Omitted at the root boundary. */
  scope?: string;
}) {
  useLoggedError(error);
  const detail = errorDetail(error);

  return (
    <section className="screen" role="alert" style={{ maxWidth: 560, padding: "24px 0" }}>
      <h1 style={{ fontSize: "1.25rem", marginBottom: 8 }}>
        {scope ? `${scope} could not be displayed` : "Something went wrong"}
      </h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        This screen failed to render. The rest of the app is unaffected, and your work is
        stored outside this screen — so nothing has been lost.
      </p>

      {/*
        "Try again" is what most failures here actually need, so it stays first
        and primary. The reload is the fallback for a failure that re-throws:
        unlike reset(), it rebuilds the module registry and the screen cache.
      */}
      <div className="screen-actions" style={{ justifyContent: "flex-start" }}>
        <button type="button" className="btn-primary" onClick={() => reset()}>
          Try again
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => window.location.reload()}
        >
          Reload this page
        </button>
      </div>

      {isAndroidApp() ? (
        <p className="muted" style={{ marginTop: 12 }}>
          In the installed Android app, Settings → Apps → WeaveForge → Storage → Clear
          storage fixes the stale-cache crashes this cannot.
        </p>
      ) : null}

      {detail ? (
        <details style={{ marginTop: 16 }}>
          <summary className="muted">Technical details</summary>
          <pre
            className="muted"
            style={{
              whiteSpace: "pre-wrap",
              fontSize: "0.8rem",
              maxHeight: 160,
              overflow: "auto",
            }}
          >
            {detail}
          </pre>
        </details>
      ) : null}

      {/*
        The way out that this screen was missing: telling somebody. It is the lazy
        boundary that keeps the rule above intact — the panel needs the container,
        and this component must not.
      */}
      <ErrorReportPanel title={scope ? `${scope} failed to display` : "The app failed to display a screen"} detail={detail} />

      <div className="card" style={{ marginTop: 24, padding: 16 }}>
        <h2 style={{ fontSize: "1rem", marginBottom: 4 }}>Still stuck?</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          Resetting removes everything this app stored in this browser — including offline
          copies of your work — and returns to the start. Work already saved to your account
          is not affected. This cannot be undone.
        </p>
        <button
          type="button"
          className="btn-secondary danger"
          onClick={() => {
            // `window.confirm` is deliberate here, and this is one of the two
            // places in the product that keeps it. An error boundary may be
            // rendering because the component tree that draws the app's own
            // modal is what failed, so the confirmation has to depend on
            // nothing that could be the thing that broke. Everywhere else uses
            // `components/confirm-dialog.tsx`.
            if (!window.confirm("Reset app data? Offline copies of your work on this device will be deleted. This cannot be undone.")) return;
            resetAppData();
          }}
        >
          Reset app data
        </button>
      </div>
    </section>
  );
}

/**
 * Whether this is the installed Android app.
 *
 * Written out here rather than reused from `features/search/infrastructure/
 * index-cache-policy` on purpose: an error boundary has to render when the
 * module that failed to load is exactly the one it would import, so it depends
 * on nothing but `lib/client-runtime-recovery` and its siblings. The tell is
 * the same one that file uses — a trusted web activity is referred by its own
 * `android-app://` scheme, which is the only signal that survives before the
 * display-mode query matches.
 */
function isAndroidApp(): boolean {
  if (typeof document === "undefined") return false;
  try {
    return document.referrer.startsWith("android-app://");
  } catch {
    return false;
  }
}
