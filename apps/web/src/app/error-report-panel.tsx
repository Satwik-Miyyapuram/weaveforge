"use client";

import { useMemo, useState } from "react";

import { getContainer } from "@/bootstrap";
import { newIssueUrl, reportMarkdown } from "@/lib/error-report/issue-url";
import { recentLogs } from "@/lib/error-report/log-buffer";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { redactAndCap } from "@/lib/error-report/redact";

/** Where the error was shown, read off the page when "Report" was pressed. */
export interface ReportContext {
  /** Screen and section, e.g. "Experiments › Metrics". */
  where?: string;
  /** When it was shown, ISO 8601. */
  at?: string;
}

/**
 * "This broke, and I want you to know about it."
 *
 * The error screens tell a reader what happened and what to try; they never gave
 * them a way to say it happened. This is that way: a report the app files for
 * them, in the issue tracker the owner actually reads.
 *
 * It is laid out as the report it produces, top to bottom, because a bug report
 * is only as useful as its steps to reproduce, and the first version of this
 * asked for "anything else? (optional)" and got nothing:
 *
 *   * **The error, as shown.** Quoted back first, so the reader knows which
 *     problem they are reporting.
 *   * **A title and the steps.** The title is prefilled from the error and
 *     editable. The steps are the one thing only the reader knows, so they are
 *     asked for by name, with an example of the shape that helps.
 *   * **What is attached without asking, listed.** Screen and section, route,
 *     version, platform, time, and a count of recent errors, with the full text
 *     one click away rather than behind a second disclosure inside the first.
 *     The logs are errors and warnings only — never `console.log`, which in this
 *     app prints note titles — redacted here so the preview is the truth, then
 *     again on the server, which is the copy that decides.
 *   * **No account identity is attached.** The issue says what broke, not who hit
 *     it.
 *   * **Failure is legible, and there is always a way to send it.** A copy with
 *     no report endpoint (the desktop app, or a deployment without a GitHub
 *     token) opens GitHub's own new-issue form with the same report filled in,
 *     where the reader submits it as themselves; "Copy report" works anywhere.
 */
export function ErrorReportPanel({
  title,
  detail,
  route,
  open,
  context,
}: {
  /** A one-line summary, prefilled from the error and editable. */
  title: string;
  /** The technical detail: message, stack, whatever the boundary captured. */
  detail: string;
  /** Where in the app this happened. */
  route?: string;
  /**
   * Already the thing the reader asked for (opened from a "Report" button), so
   * shown in full. Without it the crash screens show it behind one disclosure,
   * under the explanation that is their main content.
   */
  open?: boolean;
  context?: ReportContext;
}) {
  const [summary, setSummary] = useState(title);
  const [steps, setSteps] = useState("");
  const [showAttached, setShowAttached] = useState(false);
  const [copied, setCopied] = useState(false);
  const [state, setState] = useState<
    { status: "idle" } | { status: "sending" } | { status: "sent"; url: string | null } | { status: "failed"; message: string; fallback: boolean }
  >({ status: "idle" });

  const logs = useMemo(() => redactAndCap(recentLogs()).text, []);
  const logCount = logs ? logs.split("\n").filter((line) => line.trim()).length : 0;
  const shown = redactAndCap(detail).text;
  const where = route ?? (typeof location === "undefined" ? "" : `${location.pathname}${location.search}`);
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "";
  // No server in the desktop app, so no endpoint: go straight to GitHub's form.
  const bridge = desktop();
  const noEndpoint = bridge !== null;
  const platform = bridge
    ? `Desktop app (${bridge.platform === "win32" ? "Windows" : bridge.platform === "darwin" ? "macOS" : "Linux"})`
    : typeof navigator === "undefined"
      ? ""
      : `Browser (${navigator.userAgent.match(/(Firefox|Edg|Chrome|Safari)\/[\d.]+/)?.[0] ?? "unknown"})`;
  const at = context?.at ?? new Date().toISOString();

  const attached: [string, string][] = [
    ["Screen", context?.where ?? ""],
    ["Route", where],
    ["Version", version],
    ["Platform", platform],
    ["Time", at.replace("T", " ").replace(/\.\d+Z$/, " UTC")],
  ];
  const cleanSteps = redactAndCap(steps).text;
  const markdown = () =>
    reportMarkdown({
      detail: shown,
      steps: cleanSteps,
      route: where,
      version,
      logs,
      context: attached.filter(([label]) => label !== "Route" && label !== "Version"),
    });
  const githubUrl = () => newIssueUrl({ title: summary, body: markdown() });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`# ${summary}\n\n${markdown()}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard refused; the GitHub route still works */
    }
  };

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
          // The route files `detail` as "What happened"; the steps and the
          // context ride in it, so the server's layout needs no new fields.
          detail: markdown().replace(/^### What happened\n\n/, ""),
          logs,
          route: where,
          appVersion: version,
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
            : response.status === 404 || response.status === 405 || response.status === 503
              ? // No endpoint, or no token behind it: GitHub's own form still works.
                "This copy of the app cannot file reports itself. Open it on GitHub to send it from your account."
              : (body.error ?? "The report could not be filed."),
        fallback: response.status !== 401,
      });
    } catch {
      // Offline, most likely: the error screen is often the first thing a reader
      // sees when the network is already the problem.
      setState({ status: "failed", message: "No connection. The report was not sent.", fallback: false });
    }
  };

  if (state.status === "sent") {
    return (
      <p className="report-sent">
        Reported — thank you.{" "}
        {state.url ? (
          <a href={state.url} target="_blank" rel="noreferrer">
            Follow it on GitHub
          </a>
        ) : (
          "It is in the issue tracker."
        )}
      </p>
    );
  }

  const body = (
    <div className="report-panel">
      <figure className="report-shown">
        <figcaption>The error you saw</figcaption>
        <blockquote>{shown || "(no message)"}</blockquote>
      </figure>

      <label className="report-field">
        <span>Title</span>
        <input value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={200} />
      </label>

      <label className="report-field">
        <span>
          What were you doing? <em>Steps to make it happen again</em>
        </span>
        <textarea
          value={steps}
          onChange={(event) => setSteps(event.target.value)}
          rows={4}
          placeholder={"1. Opened the experiment “baseline-lr3e4”\n2. Scrolled to Metrics\n3. The error appeared instead of the chart"}
        />
      </label>

      <section className="report-attached" aria-label="Attached automatically">
        <div className="report-attached-head">
          <span>Attached automatically</span>
          <button type="button" className="error-report-link" onClick={() => setShowAttached((v) => !v)}>
            {showAttached ? "Hide full text" : "Show full text"}
          </button>
        </div>
        <dl>
          {attached
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          <div>
            <dt>Recent errors</dt>
            <dd>{logCount === 0 ? "none logged" : `${logCount} line${logCount === 1 ? "" : "s"} from this session`}</dd>
          </div>
        </dl>
        {showAttached ? <pre className="report-preview">{markdown()}</pre> : null}
        <p className="report-privacy">Nothing about your account is included, and nothing is sent until you press the button below.</p>
      </section>

      <div className="report-actions">
        {noEndpoint ? (
          <a className="btn-primary" href={githubUrl()} target="_blank" rel="noreferrer">
            Open on GitHub to send
          </a>
        ) : (
          <button type="button" className="btn-primary" onClick={() => void send()} disabled={state.status === "sending"}>
            {state.status === "sending" ? "Sending…" : "Send report"}
          </button>
        )}
        <button type="button" className="btn-secondary" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy report"}
        </button>
        {noEndpoint ? <span className="report-hint">Opens GitHub with this filled in; you submit it there.</span> : null}
      </div>
      {state.status === "failed" ? (
        <p className="report-failed" role="alert">
          {state.message}{" "}
          {state.fallback ? (
            <a href={githubUrl()} target="_blank" rel="noreferrer">
              Open on GitHub
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );

  if (open) return body;
  return (
    <details className="report-disclosure">
      <summary>Report this problem</summary>
      {body}
    </details>
  );
}
