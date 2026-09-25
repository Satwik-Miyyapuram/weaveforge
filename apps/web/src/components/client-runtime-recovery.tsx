"use client";

import { useEffect } from "react";
import { recoverClientRuntime } from "@/lib/client-runtime-recovery";
import { alreadyRecorded, installConsoleCapture, recordError } from "@/lib/error-report/log-buffer";
import { installRequestLog } from "@/lib/error-report/request-log";
import { logToApp } from "@/lib/error-report/app-log";

function looksLikeChunkFailure(message: string): boolean {
  return /ChunkLoadError|Loading chunk [\d]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(
    message,
  );
}

/**
 * Auto-recover once when a deploy leaves the TWA/PWA on stale hashed chunks.
 * Mounted from the root layout (client).
 */
export function ClientRuntimeRecovery() {
  useEffect(() => {
    // Errors and warnings from here on are kept for a bug report — see
    // `lib/error-report/log-buffer`. Installed with the shell rather than by the
    // error screen, because the log a reader needs is the one written *before*
    // the failure, and an error screen only exists afterwards.
    installConsoleCapture();
    // And every request that comes back non-ok, with its URL and status, goes to
    // the shell's log file — the record a dead window cannot otherwise leave.
    // See `lib/error-report/request-log`.
    installRequestLog();

    const onError = (event: ErrorEvent) => {
      const msg = event.message || "";
      // An uncaught error is printed by the *browser*, not through
      // `console.error`, so the capture above never sees it. This is where it gets
      // kept — with the line it happened on, which is the part a report needs.
      const detail = [
        event.error instanceof Error ? (event.error.stack ?? `${event.error.name}: ${event.error.message}`) : msg,
        event.filename ? `at ${event.filename}:${event.lineno}:${event.colno}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      recordError(detail);
      // And to the shell's file, which survives the window. The in-memory buffer
      // is refreshed on every mount and is gone with the tab; this is the copy a
      // reader can open after a crash.
      //
      // Only a real script error, though. This listener is in the capture phase,
      // so it also fires for a resource that failed to load — an image, a font,
      // a stylesheet — and those events carry no `message` and no `error`. The
      // buffer has always guarded that case; the shell log did not, so every
      // broken image on every screen became a line reading "uncaught error" in
      // the record the reader is being asked to trust. A record with invented
      // failures in it is worse than a short one.
      //
      // `alreadyRecorded` is the other half: the same event fires again for
      // every re-render, retry and route change that repeats it, and this file
      // is a log that outlives the window. A render loop would otherwise write
      // thousands of identical lines into a record a person is asked to read.
      if ((msg || event.error) && !alreadyRecorded(detail)) {
        logToApp({
          level: "error",
          source: "uncaught",
          message: msg || (event.error instanceof Error ? event.error.message : "uncaught error"),
          detail,
        });
      }

      const target = event.target;
      const scriptFailed =
        !!target &&
        typeof (target as HTMLElement).tagName === "string" &&
        (target as HTMLElement).tagName.toLowerCase() === "script";
      if (scriptFailed || looksLikeChunkFailure(msg)) {
        void recoverClientRuntime();
      }
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg =
        reason instanceof Error
          ? `${reason.name} ${reason.message}`
          : String(reason ?? "");
      // A rejection may be printed by nobody at all, so it is recorded before
      // anything else looks at it.
      recordError(reason instanceof Error ? (reason.stack ?? msg) : msg);
      // Deduplicated for the same reason an error event is: a retry loop that
      // rejects on every attempt is one failure with a rate, not a thousand
      // failures, and the file has to stay readable.
      const detail = reason instanceof Error ? reason.stack : undefined;
      if (!alreadyRecorded(`${msg}${detail ?? ""}`)) {
        logToApp({
          level: "error",
          source: "unhandled-rejection",
          message: msg || "unhandled rejection",
          detail,
        });
      }
      if (looksLikeChunkFailure(msg)) {
        void recoverClientRuntime();
      }
    };
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
