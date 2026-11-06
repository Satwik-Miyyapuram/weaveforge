"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type BibFinding } from "@weaveforge/core";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { formatError } from "@/lib/format-error";
import type { DesktopTexCompileResult, DesktopTexError } from "@/lib/desktop/desktop-bridge";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/button";
import { typedCore } from "@/lib/rust-core";
import { PdfReader } from "@/features/reader/ui/pdf-reader";

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
    () => typedCore().checkBibliography({ sources: files, bibliography: typedCore().parseBibEntries(files) }),
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
  const [tool, setTool] = useState<string | null | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [stopped, setStopped] = useState(false);
  // Read after the compile returns, so a Cancel pressed during it counts.
  const stopAsked = useRef(false);
  const [result, setResult] = useState<DesktopTexCompileResult | null>(null);
  const [error, setError] = useState("");
  // The compiled PDF, shown in our own viewer instead of a blob popup.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const bridge = desktop();

  // A new PDF or leaving the page frees the old blob.
  useEffect(() => {
    if (!pdfUrl) return;
    return () => URL.revokeObjectURL(pdfUrl);
  }, [pdfUrl]);

  // A long compile shows it is still going, counted from when it started.
  useEffect(() => {
    if (!running) return;
    const startedAt = Date.now();
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);

  // Probed once per mount, not once per render. A machine that gains a TeX
  // while the app is open shows the button after the next reload, which is a
  // smaller surprise than a button appearing under the cursor.
  useEffect(() => {
    const probe = desktop();
    if (!probe || typeof probe.probeTex !== "function") return;
    let cancelled = false;
    void probe
      .probeTex()
      .then((found) => {
        if (!cancelled) setTool(found?.version ?? null);
      })
      .catch(() => {
        if (!cancelled) setTool(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!bridge || typeof bridge.probeTex !== "function") return null;
  if (tool === undefined || tool === null) return null;

  const cancel = async () => {
    stopAsked.current = true;
    setStopping(true);
    try {
      await bridge.cancelTex?.();
    } catch (cause) {
      stopAsked.current = false;
      setStopping(false);
      setError(formatError(cause));
    }
  };

  const run = async () => {
    setRunning(true);
    stopAsked.current = false;
    setStopping(false);
    setStopped(false);
    setError("");
    try {
      const compiled = await bridge.compileTex(files, entryFile);
      setStopped(stopAsked.current && !compiled.ok);
      setResult(compiled);
      if (compiled.pdf) {
        setPdfUrl(URL.createObjectURL(new Blob([compiled.pdf], { type: "application/pdf" })));
      }
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setStopping(false);
      setRunning(false);
    }
  };

  return (
    <div className="project-checks-compile">
      <Button variant="link" disabled={running} onClick={() => void run()}>
        {running ? `Compiling…${seconds > 0 ? ` ${seconds} s` : ""}` : "Compile here"}
      </Button>
      {running && bridge.cancelTex && (
        <Button variant="ghost" disabled={stopping} onClick={() => void cancel()}>
          Cancel
        </Button>
      )}
      <span className="project-checks-engine">{tool}</span>
      {error && <FormError>{error}</FormError>}
      {stopped && <span className="muted">Stopped.</span>}
      {pdfUrl && (
        <div className="workshop-pdf">
          <PdfReader url={pdfUrl} paperTitle="Compiled PDF" />
        </div>
      )}
      {result && !result.ok && !stopped && (
        <>
          <FormError>
            {result.errors.length} {result.errors.length === 1 ? "error" : "errors"} — no PDF.
          </FormError>
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
