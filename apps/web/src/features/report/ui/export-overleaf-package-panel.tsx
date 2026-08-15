"use client";

import { useState } from "react";
import type { Paper, ReportSectionTreeNode } from "@weaveforge/core";
import { downloadOverleafExportPackage } from "@/features/overleaf/application/download-overleaf-export";
import { Modal } from "@/components/modal";
import { FormError } from "@/components/form-error";
import { Select } from "@/components/select";
import { formatError } from "@/lib/format-error";

/**
 * Compact trigger + modal for a plaintext Overleaf ZIP (browser-only; nothing
 * uploaded to WeaveForge). Stays out of the report page chrome until opened.
 */
export function ExportOverleafPackagePanel({
  tree,
  papers,
  hideTrigger = false,
  open: openProp,
  onOpenChange,
}: {
  tree: readonly ReportSectionTreeNode[];
  papers: readonly Paper[];
  /** When true, do not render the header button (parent opens via `open`). */
  hideTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? Boolean(openProp) : uncontrolledOpen;
  function setOpen(next: boolean) {
    if (!controlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }
  const [busy, setBusy] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeBib, setIncludeBib] = useState(true);
  const [bibScope, setBibScope] = useState<"cited" | "all">("all");
  const [title, setTitle] = useState("Thesis report");
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  function close() {
    if (busy) return;
    setOpen(false);
    setError(null);
  }

  async function run() {
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      const result = await downloadOverleafExportPackage(tree, papers, {
        title,
        includeSectionNotes: includeNotes,
        includeBibliography: includeBib,
        bibliographyScope: bibScope,
      });
      setWarnings(result.warnings);
      if (result.warnings.length === 0) setOpen(false);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!hideTrigger && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setError(null);
            setWarnings([]);
            setOpen(true);
          }}
        >
          Export LaTeX…
        </button>
      )}
      {open && (
        <Modal title="Export to Overleaf" onClose={close}>
          <p className="muted" style={{ marginTop: 0 }}>
            Builds a plaintext LaTeX ZIP (main.tex + bibliography + figures) in this browser only.
            WeaveForge does not push to Overleaf.
          </p>
          <p className="muted" style={{ fontStyle: "italic" }}>
            The package leaves WeaveForge&apos;s access boundary — plaintext on your device.
          </p>
          <div className="export-overleaf-form">
            <label className="export-overleaf-field">
              Document title
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="export-overleaf-check">
              <input
                type="checkbox"
                className="themed-check"
                checked={includeNotes}
                onChange={(e) => setIncludeNotes(e.target.checked)}
                disabled={busy}
              />
              <span>Include section notes (Markdown → LaTeX)</span>
            </label>
            <label className="export-overleaf-check">
              <input
                type="checkbox"
                className="themed-check"
                checked={includeBib}
                onChange={(e) => setIncludeBib(e.target.checked)}
                disabled={busy}
              />
              <span>Include bibliography from paper library ({papers.length} papers)</span>
            </label>
            {includeBib && (
              <label className="export-overleaf-field">
                Bibliography contains
                <Select
                  value={bibScope}
                  onChange={(e) => setBibScope(e.target.value as "cited" | "all")}
                  disabled={busy}
                  aria-label="Bibliography contains"
                >
                  <option value="all">All {papers.length} papers in the library</option>
                  <option value="cited">Only papers cited in this report</option>
                </Select>
                <span className="muted">
                  {bibScope === "all"
                    ? "Adds \\nocite{*} so every entry prints, not just the cited ones."
                    : "A finished thesis bibliography — uncited papers are left out."}
                </span>
              </label>
            )}
            {error && <FormError>{error}</FormError>}
            {warnings.length > 0 && (
              <ul className="muted export-overleaf-warnings">
                {warnings.slice(0, 8).map((w) => (
                  <li key={w}>{w}</li>
                ))}
                {warnings.length > 8 ? <li>…and {warnings.length - 8} more</li> : null}
              </ul>
            )}
            <div className="screen-actions">
              <button className="btn-primary" type="button" disabled={busy} onClick={() => void run()}>
                {busy ? "Building…" : "Download ZIP"}
              </button>
              <button className="btn-secondary" type="button" disabled={busy} onClick={close}>
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
