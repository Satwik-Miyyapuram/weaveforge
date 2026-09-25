"use client";

import { useCallback, useEffect, useState } from "react";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { recentLogs } from "@/lib/error-report/log-buffer";
import { formatError } from "@/lib/format-error";
import { FormError } from "@/components/form-error";

/**
 * Settings → Data → the application log.
 *
 * Why this exists at all: nothing used to be written under `userData`, so when
 * the window died there was no record left to read — and two diagnoses in one
 * session came down to "if only the last request had been on disk". The file is
 * written by the shell (`apps/desktop/src/app-log.ts`); this is the surface that
 * lets a reader open it.
 *
 * Three states, and they are deliberately three:
 *
 *   * `undefined` — not read yet. Nothing renders but the heading, so the panel
 *     does not flash "nothing has been logged" at a reader before its answer
 *     arrives.
 *   * a log — the file's path, the newest lines, and the two actions.
 *   * `null` — there is no log to read. That is a browser, or a shell built
 *     before these channels existed, and the honest answer there is the
 *     in-memory console history and a sentence saying why there is no file.
 */

/** How much of the log is shown. The file keeps everything; this is the panel. */
const SHOWN_CHARS = 20_000;

type AppLogView = { file: string; text: string; complete: boolean } | null;

export function AppLogPanel() {
  const [log, setLog] = useState<AppLogView | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const bridge = desktop();
    const read = bridge?.readAppLog?.bind(bridge);
    // No bridge, or one older than this feature: there is no file anywhere for
    // the reader to open, and the panel says so rather than offering a button
    // that cannot work.
    if (!read) {
      setLog(null);
      return;
    }
    try {
      setLog(await read());
      setError(null);
    } catch (err) {
      // A shell that has the channel and cannot answer it. Reported as an error
      // rather than silently downgraded: the file is the feature, and pretending
      // it is a browser would hide a broken install.
      //
      // `setLog` is *not* left at `undefined` on this path. It was, and the
      // result was an empty panel under the heading — the error went into state
      // that only the success branch renders, and the reader got a blank space
      // where the explanation should have been. A failed read now reads as a
      // log with no text, so the error and the path are on screen and Refresh
      // can be pressed again.
      setLog({ file: "", text: "", complete: true });
      setError(formatError(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reveal = async () => {
    setBusy(true);
    try {
      await desktop()?.revealAppLog?.();
      setError(null);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h4 className="settings-group">Application log</h4>
      {log === undefined ? null : log === null ? (
        <NoFileFallback />
      ) : (
        <>
          <p className="muted jump-to-meta">
            Every request that failed — its address, its status and the start of what came back —
            and every error this window raised. Written to a file as it happens, so a window that
            closes unexpectedly leaves a record behind.
          </p>
          {error && <FormError>{error}</FormError>}
          {/* The path is shown only when there is one: a failed read answers
              with no file, and printing an empty `<code>` would be a second,
              quieter lie under the error above it. */}
          {log.file && (
            <p className="muted app-log-path">
              <code>{log.file}</code>
            </p>
          )}
          {!log.complete && (
            <p className="muted">
              Only the most recent entries are shown. Use “Show in folder” to read the whole file.
            </p>
          )}
          <div className="app-log-actions">
            <button type="button" className="btn-secondary" onClick={() => void load()}>
              Refresh
            </button>
            {log.file && (
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => void reveal()}
              >
                {busy ? "Opening…" : "Show in folder"}
              </button>
            )}
          </div>
          {log.text ? (
            <pre className="app-log-text">{log.text.slice(-SHOWN_CHARS)}</pre>
          ) : (
            <p className="muted">
              {error ? "The log could not be read." : "Nothing has been logged yet."}
            </p>
          )}
        </>
      )}
    </>
  );
}

/** A browser, or a shell with no log channels at all. */
function NoFileFallback() {
  const memory = recentLogs();
  return (
    <>
      <p className="muted jump-to-meta">
        Errors and warnings from this session. The installed app writes the same record to a file so
        it survives a crash; a browser tab has nowhere to put one.
      </p>
      {memory ? (
        <pre className="app-log-text">{memory.slice(-SHOWN_CHARS)}</pre>
      ) : (
        <p className="muted">Nothing has been logged this session.</p>
      )}
    </>
  );
}
