"use client";

import { useMemo, useState } from "react";
import { PAPER_STATUSES, parsePaperRef, type Paper, type PaperRef, type PaperStatus } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Select } from "@/components/select";
import { paperSourceNoteScaffold } from "../application/paper-source-note-scaffold";


type RefKind = PaperRef["kind"]; // "arxiv" | "doi" | "zotero"

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

/**
 * Add-paper form. UI only: it collects input and delegates to the AddPaper /
 * ImportPaper use-cases via the container. The import source (arXiv, DOI,
 * Zotero) is chosen here; the resolver picks the matching IMetadataSource.
 */
export function AddPaperForm({ onAdded }: { onAdded?: () => void }) {
  const [title, setTitle] = useState("");
  const [refKind, setRefKind] = useState<RefKind>("url");
  const [refValue, setRefValue] = useState("");
  const [status, setStatus] = useState<PaperStatus>("to_read");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The picker states intent; the parser decides what was actually pasted, so
  // an abs link in the arXiv box resolves as arXiv. Shown so the researcher
  // sees which source will answer before submitting.
  const detected = useMemo(
    () => (refValue.trim() ? parsePaperRef(refKind, refValue) : null),
    [refKind, refValue],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const papers = getContainer().papers;
      const paper = refValue.trim()
        ? await papers.importPaper.fromRef({ kind: refKind, value: refValue.trim() }, status)
        : await papers.addPaper.addManual({ title, status });
      if (!paper.summary || paper.summary === "No summary yet.") {
        const citeKey =
          typeof paper.metadata?.["citeKey"] === "string"
            ? paper.metadata["citeKey"]
            : undefined;
        const scaffold = paperSourceNoteScaffold({
          title: paper.title,
          authors: paper.authors,
          year: paper.year,
          venue: paper.venue,
          doi: paper.doi,
          citeKey,
        });
        await papers.updatePaper.setSummary(paper.id, scaffold);
      }
      await papers.autoPush(paper);
      setTitle("");
      setRefValue("");
      onAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
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
          {detected && (
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
                {s.replace("_", " ")}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn-primary" disabled={busy}>
        {busy ? "Adding…" : "Add paper"}
      </button>
    </form>
  );
}
