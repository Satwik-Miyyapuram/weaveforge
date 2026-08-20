"use client";

import { useState } from "react";
import { type Paper } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { formatError } from "@/lib/format-error";

/**
 * Inline editor for a paper's DOI / arXiv ID.
 *
 * Citation alerts need one of these to query upstream. The UI used to state the
 * requirement in a tooltip on a disabled button and offer no way to satisfy it.
 */
export function PaperIdentifiersEditor({
  paper,
  onClose,
  onReplace,
}: {
  paper: Paper;
  onClose: () => void;
  onReplace: (p: Paper) => void;
}) {
  const [doi, setDoi] = useState(paper.doi ?? "");
  const [arxivId, setArxivId] = useState(paper.arxivId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onReplace(
        await getContainer().papers.updatePaper.setIdentifiers(paper.id, { doi, arxivId }),
      );
      onClose();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="paper-ids-editor">
      <label className="paper-ids-field">
        DOI
        <input
          value={doi}
          onChange={(e) => setDoi(e.target.value)}
          placeholder="10.1145/3292500"
          disabled={busy}
        />
      </label>
      <label className="paper-ids-field">
        arXiv ID
        <input
          value={arxivId}
          onChange={(e) => setArxivId(e.target.value)}
          placeholder="1706.03762"
          disabled={busy}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="screen-actions">
        <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
