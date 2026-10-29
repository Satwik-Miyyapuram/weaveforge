"use client";

import { enumLabel } from "@/lib/enum-label";
import { useMemo, useRef, useState } from "react";
import { PAPER_STATUSES, parsePaperRef, type Paper, type PaperRef, type PaperStatus } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Select } from "@/components/select";
import { scaffoldNewPaperNote } from "../application/paper-source-note-scaffold";
import { useSubmit } from "@/lib/hooks/use-submit";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/button";
import { formatError } from "@/lib/format-error";
import type { PdfDropOutcome } from "../application/paper-from-pdf";
import { addPdfFiles } from "./pdf-drop";


type RefKind = Exclude<PaperRef["kind"], "bibliographic">;

const REF_LABELS: Record<RefKind, string> = {
  url: "URL",
  arxiv: "arXiv id",
  doi: "DOI",
  zotero: "Zotero key",
};

const REF_PLACEHOLDERS: Record<RefKind, string> = {
  url: "https://arxiv.org/abs/2305.12345",
  arxiv: "2305.12345 — or an abs/pdf link",
  doi: "10.1145/3592979 — or a doi.org link",
  zotero: "ABCD1234",
};

/** What the pasted value actually resolves to, for the hint under the field. */
const DETECTED_LABELS: Record<RefKind, string> = {
  url: "reading the page",
  arxiv: "arXiv",
  doi: "Crossref DOI",
  zotero: "Zotero",
};

const REF_ORDER: RefKind[] = ["url", "arxiv", "doi", "zotero"];

/** The toast after Add paper: a duplicate is found, not added (E10). */
export function addedPaperMessage(created: boolean): string {
  return created ? "Paper added" : "Already in library";
}

/**
 * Add-paper form. UI only: it collects input and delegates to the AddPaper /
 * ImportPaper use-cases via the container. The import source (arXiv, DOI,
 * Zotero) is chosen here; the resolver picks the matching IMetadataSource.
 */
export function AddPaperForm({
  onAdded,
  onPdfs,
}: {
  onAdded?: (paper: Paper, created: boolean) => void;
  /** Offers a PDF picker; the outcomes are the caller's to announce. */
  onPdfs?: (outcomes: PdfDropOutcome[]) => void;
}) {
  const pdfRef = useRef<HTMLInputElement>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [refKind, setRefKind] = useState<RefKind>("url");
  const [refValue, setRefValue] = useState("");
  const [status, setStatus] = useState<PaperStatus>("to_read");

  // The picker states intent; the parser decides what was actually pasted, so
  // an abs link in the arXiv box resolves as arXiv. Shown so the researcher
  // sees which source will answer before submitting.
  const detected = useMemo(
    () => (refValue.trim() ? parsePaperRef(refKind, refValue) : null),
    [refKind, refValue],
  );

  const { busy, error, submit } = useSubmit(async () => {
    const papers = getContainer().papers;
    const { paper, created } = refValue.trim()
      ? await papers.importPaper.importRef({ kind: refKind, value: refValue.trim() }, status)
      : await papers.addPaper.add({ title, status });
    // A duplicate is the library's own paper: its note and Zotero item exist.
    if (created) {
      const saved = await scaffoldNewPaperNote(paper, papers.updatePaper);
      // Zotero is its own facade now: the push is a bibliography concern, not a
      // property of the shelf.
      await getContainer().zotero.autoPush(saved);
    }
    setTitle("");
    setRefValue("");
    onAdded?.(paper, created);
  });

  async function pickPdfs(input: HTMLInputElement) {
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length === 0 || !onPdfs) return;
    setPdfBusy(true);
    setPdfError(null);
    try {
      onPdfs(await addPdfFiles(files));
    } catch (err) {
      setPdfError(formatError(err));
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <form className="card add-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="title">Title</label>
        <input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Paper title"
          required={!refValue.trim()}
        />
      </div>
      <div className="field-row import-row">
        <div className="field">
          <label htmlFor="refKind">…or import from</label>
          <Select
            id="refKind"
            value={refKind}
            onChange={(e) => setRefKind(e.target.value as RefKind)}
          >
            {REF_ORDER.map((k) => (
              <option key={k} value={k}>{REF_LABELS[k]}</option>
            ))}
          </Select>
        </div>
        <div className="field">
          <label htmlFor="refValue">{REF_LABELS[refKind]}</label>
          <input
            id="refValue"
            value={refValue}
            onChange={(e) => setRefValue(e.target.value)}
            placeholder={REF_PLACEHOLDERS[refKind]}
            aria-describedby={detected ? "refValueHint" : undefined}
          />
          {detected && detected.kind !== "bibliographic" && (
            <p id="refValueHint" className="muted field-hint">
              Recognized as {DETECTED_LABELS[detected.kind]}
              {detected.kind !== "url" ? ` — ${detected.value}` : ""}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="status">Status</label>
          <Select
            id="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as PaperStatus)}
          >
            {PAPER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {enumLabel("paperStatus", s)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {onPdfs && (
        <div className="field">
          <label htmlFor="pdfFile">…or add from a PDF</label>
          {/* The native input stays for the label and screen readers; the
              app's own button opens it, since no theme can restyle the
              browser's "Choose files / No file chosen". */}
          <input
            ref={pdfRef}
            id="pdfFile"
            className="sr-only"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            disabled={pdfBusy}
            aria-describedby="pdfFileHint"
            onChange={(e) => void pickPdfs(e.currentTarget)}
          />
          <div>
            <Button size="sm" disabled={pdfBusy} onClick={() => pdfRef.current?.click()}>
              {pdfBusy ? "Reading PDF…" : "Choose PDFs…"}
            </Button>
          </div>
          <p id="pdfFileHint" className="muted field-hint">The DOI or title on its first page finds the paper. You can also drop PDFs on Papers.</p>
        </div>
      )}
      {(pdfError ?? error) && <FormError>{pdfError ?? error}</FormError>}
      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? "Adding…" : "Add paper"}
      </Button>
    </form>
  );
}
