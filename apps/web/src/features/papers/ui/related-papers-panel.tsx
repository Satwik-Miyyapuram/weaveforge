"use client";

import { useState } from "react";
import { type Paper } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { formatError } from "@/lib/format-error";

type RelatedHit = {
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  arxivId?: string;
  url?: string;
  abstract?: string;
  citationCount?: number;
};

export function RelatedPapersPanel({ paper, onChanged }: { paper: Paper; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<RelatedHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function findRelated() {
    setBusy(true);
    setError(null);
    setMsg(null);
    setOpen(true);
    try {
      const { fetchRelatedPapers } = await import(
        "@/features/papers/application/fetch-related-papers"
      );
      const library = await getContainer().papers.loadScreenData();
      const next = await fetchRelatedPapers(paper, library.papers);
      setHits(next);
      if (next.length === 0) setMsg("No related papers found (needs DOI or arXiv id).");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function addHit(hit: RelatedHit) {
    setBusy(true);
    setError(null);
    try {
      await getContainer().papers.addPaper.addManual({
        title: hit.title,
        authors: hit.authors,
        year: hit.year,
        doi: hit.doi,
        arxivId: hit.arxivId,
        url: hit.url,
        summary: hit.abstract,
      });
      setMsg(`Added “${hit.title}”`);
      setHits((prev) => prev.filter((h) => h.title !== hit.title));
      onChanged();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="related-papers">
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => void findRelated()}>
        {busy ? "Finding…" : "Find related papers"}
      </button>
      {open && (
        <div className="related-papers-panel">
          {error && <p className="error">{error}</p>}
          {msg && <p className="muted">{msg}</p>}
          <ul className="related-papers-list">
            {hits.map((h) => (
              <li key={`${h.doi ?? h.arxivId ?? h.title}`}>
                <strong className="related-paper-title">{h.title}</strong>
                <p className="muted related-paper-meta">
                  {h.authors.slice(0, 3).join(", ")}
                  {h.authors.length > 3 ? " et al." : ""}
                  {h.year ? ` · ${h.year}` : ""}
                  {typeof h.citationCount === "number"
                    ? ` · ${h.citationCount.toLocaleString()} citation${h.citationCount === 1 ? "" : "s"}`
                    : ""}
                </p>
                {h.url ? (
                  <a
                    className="related-paper-url"
                    href={h.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={h.url}
                  >
                    {h.url}
                  </a>
                ) : (
                  <p className="muted related-paper-url">No URL available</p>
                )}
                <div className="related-paper-actions">
                  {h.url && (
                    <a
                      className="link-btn"
                      href={h.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open paper
                    </a>
                  )}
                  <button type="button" className="link-btn" disabled={busy} onClick={() => void addHit(h)}>
                    Add to library
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
