"use client";

import { useMemo, useState } from "react";
import { checkBibliography, parseBibEntries, type BibFinding } from "@weaveforge/core";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { formatError } from "@/lib/format-error";
import type { DesktopTexCompileResult, DesktopTexError } from "@/lib/desktop/desktop-bridge";

type SourceFile = { path: string; content: string };

/**
 * The two things a reader wants from a project that the editor upstream does
 * not tell them: whether the bibliography holds together, and what the PDF
 * looks like right now.
 *
 * The bibliography half needs nothing but the sources, so it runs everywhere,
 * on every render, with no button to press. The compile half needs a TeX, so
 * it appears only in the desktop build and only once a probe has found one —
 * a browser copy, or a machine with no TeX, never sees it mentioned.
 */
export function ProjectChecks({ files, entryFile }: { files: readonly SourceFile[]; entryFile: string }) {
  const report = useMemo(
    () => checkBibliography({ sources: files, bibliography: parseBibEntries(files) }),
    [files],
  );

  return (
    <div className="project-checks">
      <Bibliography findings={report.findings} entryCount={report.entryCount} />
      <Compile files={files} entryFile={entryFile} />
    </div>
  );
}

function Bibliography({ findings, entryCount }: { findings: readonly BibFinding[]; entryCount: number }) {
  const [open, setOpen] = useState(false);
  const errors = findings.filter((finding) => finding.severity === "error").length;

  if (!entryCount && !findings.length) return null;

  return (
    <details className="project-checks-bib" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        Bibliography — {entryCount} {entryCount === 1 ? "entry" : "entries"}
        {findings.length === 0 ? ", nothing to fix" : `, ${errors} to fix, ${findings.length - errors} to tidy`}
      </summary>
      {findings.length > 0 && (
        <ul className="project-checks-findings">
          {findings.map((finding, index) => (
            <li key={`${finding.file}:${finding.line}:${finding.kind}:${index}`} className={finding.severity}>
              <span className="project-checks-where">
                {finding.file}:{finding.line}
              </span>{" "}
              {finding.message}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function Compile({ files, entryFile }: { files: readonly SourceFile[]; entryFile: string }) {
  // Probed once when the panel first renders. A machine that gains a TeX while
  // the app is open shows the button after the next reload, which is a smaller
  // surprise than a button appearing under the cursor.
  const [tool, setTool] = useState<string | null | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DesktopTexCompileResult | null>(null);
  const [error, setError] = useState("");
  const bridge = desktop();

  if (!bridge || typeof bridge.probeTex !== "function") return null;
  if (tool === undefined) {
    void bridge
      .probeTex()
      .then((found) => setTool(found?.version ?? null))
      .catch(() => setTool(null));
    return null;
  }
  if (tool === null) return null;

  const run = async () => {
    setRunning(true);
    setError("");
    try {
      const compiled = await bridge.compileTex(files, entryFile);
      setResult(compiled);
      if (compiled.pdf) {
        const url = URL.createObjectURL(new Blob([compiled.pdf], { type: "application/pdf" }));
        window.open(url, "_blank", "noreferrer");
        // Revoked once the new tab has had time to take it; holding the blob
        // for the life of the session would keep a thesis-sized PDF in memory.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="project-checks-compile">
      <button type="button" className="link-btn" disabled={running} onClick={() => void run()}>
        {running ? "Compiling…" : "Compile here"}
      </button>
      <span className="project-checks-engine">{tool}</span>
      {error && <p className="error">{error}</p>}
      {result && !result.ok && (
        <>
          <p className="error">
            {result.errors.length} {result.errors.length === 1 ? "error" : "errors"} — no PDF.
          </p>
          <ul className="project-checks-findings">
            {result.errors.slice(0, 40).map((texError: DesktopTexError, index) => (
              <li key={`${texError.file}:${texError.line}:${index}`} className="error">
                <span className="project-checks-where">
                  {texError.file}
                  {texError.line ? `:${texError.line}` : ""}
                </span>{" "}
                {texError.message}
              </li>
            ))}
          </ul>
          <details className="project-checks-log">
            <summary>Full log</summary>
            <pre>{result.log}</pre>
          </details>
        </>
      )}
    </div>
  );
}
