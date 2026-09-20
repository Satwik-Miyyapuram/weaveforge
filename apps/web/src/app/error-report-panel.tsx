"use client";

import { useState } from "react";

import { getContainer } from "@/bootstrap";
import { recentLogs } from "@/lib/error-report/log-buffer";
import { redactAndCap } from "@/lib/error-report/redact";

/**
 * "This broke, and I want you to know about it."
 *
 * The error screens tell a reader what happened and what to try; they never gave
 * them a way to say it happened. This is that way: a report the app files for
 * them, in the issue tracker the owner actually reads.
 *
 * Three deliberate properties:
 *
 *   * **What will be sent is shown first, and can be edited.** A report is
 *     somebody else's words on a public tracker; they get to see and change them
 *     before that happens. The logs are errors and warnings only — never
 *     `console.log`, which in this app prints note titles — and both halves are
 *     redacted here so the preview is the truth, then again on the server, which
 *     is the copy that decides.
 *   * **No account identity is attached.** The issue says what broke, not who hit
 *     it. The reporter's account is not needed to fix a bug, and a public issue is
 *     not the place to publish one.
 *   * **Failure is legible.** Not configured, refused, rate-limited, offline: each
 *     says which, because "report failed" leaves the reader with the same problem
 *     plus a mystery.
 */
export function ErrorReportPanel({
  title,
  detail,
  route,
}: {
  /** A one-line summary, prefilled from the error and editable. */
  title: string;
  /** The technical detail: message, stack, whatever the boundary captured. */
  detail: string;
  /** Where in the app this happened. */
  route?: string;
}) {
  const [summary, setSummary] = useState(title);
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<
    { status: "idle" } | { status: "sending" } | { status: "sent"; url: string | null } | { status: "failed"; message: string }
  >({ status: "idle" });

  const logs = redactAndCap(recentLogs()).text;
  const problem = redactAndCap([notes, detail].filter(Boolean).join("\n\n")).text;

  const send = async () => {
    setState({ status: "sending" });
    try {
      const token = await getContainer().auth.auth.getAccessToken();
      const response = await fetch("/api/report-issue", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          title: summary,
          detail: problem,
          logs,
          route: route ?? (typeof location === "undefined" ? "" : location.pathname),
          appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "",
        }),
      });

      const body = (await response.json().catch(() => ({}))) as { url?: string | null; error?: string };
      if (response.ok) {
        setState({ status: "sent", url: body.url ?? null });
        return;
      }
      setState({
        status: "failed",
        message:
          response.status === 401
            ? "Sign in again, then retry — a report needs an account so the tracker cannot be filled by strangers."
            : response.status === 404 || response.status === 405
              ? // A packaged desktop build serves a static copy of the app: it has no
                // server, so it has no report endpoint. The details above are the same
                // either way, and saying so beats a button that can never work.
                "This copy of the app cannot file reports. The details above can be copied and sent on."
              : (body.error ?? "The report could not be filed."),
      });
    } catch {
      // Offline, most likely: the error screen is often the first thing a reader
      // sees when the network is already the problem.
      setState({ status: "failed", message: "No connection. The report was not sent." });
    }
  };

  if (state.status === "sent") {
    return (
      <p className="muted" style={{ marginTop: 16 }}>
        Reported.{" "}
        {state.url ? (
          <a href={state.url} target="_blank" rel="noreferrer">
            Track it here
          </a>
        ) : (
          "It is in the issue tracker."
        )}
      </p>
    );
  }

  return (
    <details style={{ marginTop: 16 }}>
      <summary className="muted" style={{ cursor: "pointer" }}>
        Report this problem
      </summary>

      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        <label className="muted" htmlFor="error-report-title">
          What went wrong, in one line
        </label>
        <input
          id="error-report-title"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          maxLength={200}
          style={{ padding: 8 }}
        />

        <label className="muted" htmlFor="error-report-notes">
          Anything else? (optional)
        </label>
        <textarea
          id="error-report-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          style={{ padding: 8 }}
        />

        {/*
          The technical half is shown rather than described. A reader who does not
          want to read it can skip it; a reader who does not want to *send* it can
          see that it is a stack trace and an error log, and nothing of theirs.
        */}
        <details>
          <summary className="muted" style={{ cursor: "pointer", fontSize: "0.9em" }}>
            What else will be sent
          </summary>
          <pre
            className="muted"
            style={{ whiteSpace: "pre-wrap", fontSize: "0.8em", maxHeight: 220, overflow: "auto" }}
          >
            {[problem, route && `Route: ${route}`, logs && `---\n${logs}`].filter(Boolean).join("\n\n")}
          </pre>
        </details>

        <div>
          <button type="button" className="button" onClick={() => void send()} disabled={state.status === "sending"}>
            {state.status === "sending" ? "Sending…" : "Send report"}
          </button>
          {state.status === "failed" ? (
            <span className="muted" style={{ marginLeft: 8 }}>
              {state.message}
            </span>
          ) : null}
        </div>
      </div>
    </details>
  );
}
