"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Paper, ReportSection } from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { formatQuoteCiteClipboard } from "@/features/papers/application/sync-annotation-excerpts";

interface StoredAnnotation {
  key?: string;
  text?: string;
  comment?: string;
  page?: string;
}

interface PinnedAnnotation {
  paper: Paper;
  annotation: StoredAnnotation;
}

/** Zotero annotations explicitly placed in this report section. */
export function SectionRelatedExcerpts({
  section,
  onInsert,
}: {
  section: ReportSection;
  onInsert: (snippet: string) => void;
}) {
  const [items, setItems] = useState<PinnedAnnotation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const loadGeneration = useRef(0);

  const reload = useCallback(async () => {
    const generation = ++loadGeneration.current;
    const papersFacade = getContainer().papers;
    const pins = await papersFacade.listAnnotationPinsForSection(section.id);
    const paperIds = [...new Set(pins.map((pin) => pin.paperId))];
    const papers = await Promise.all(paperIds.map((id) => papersFacade.getPaper(id)));
    if (generation !== loadGeneration.current) return;
    const byPaper = new Map(
      papers.flatMap((paper) => (paper ? [[paper.id, paper] as const] : [])),
    );
    const rows = pins.flatMap((pin): PinnedAnnotation[] => {
      const paper = byPaper.get(pin.paperId);
      if (!paper) return [];
      const annotations =
        (paper.metadata?.["annotations"] as StoredAnnotation[] | undefined) ?? [];
      const annotation = annotations.find((item) => item.key === pin.annotationKey);
      return annotation ? [{ paper, annotation }] : [];
    });
    setItems(rows);
  }, [section.id]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void reload().catch((reason) => {
      if (cancelled) return;
      setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      cancelled = true;
      loadGeneration.current += 1;
    };
  }, [reload]);

  if (items.length === 0 && !error) {
    return (
      <aside className="section-excerpts muted">
        <p className="muted">No Zotero annotations pinned to this section.</p>
      </aside>
    );
  }

  return (
    <aside className="section-excerpts" aria-label="Related annotations">
      <h3 className="section-excerpts-title">Pinned annotations</h3>
      {error && <p className="error">{error}</p>}
      <ul className="section-excerpts-list">
        {items.map(({ paper, annotation }, index) => {
          const quote = (annotation.text ?? annotation.comment ?? "").trim();
          return (
            <li key={`${paper.id}:${annotation.key ?? index}`} className="section-excerpt-row">
              <p className="section-excerpt-quote">
                {quote.slice(0, 120)}{quote.length > 120 ? "…" : ""}
              </p>
              <p className="muted">
                {paper.title}{annotation.page ? ` · p.${annotation.page}` : ""}
              </p>
              <div className="section-excerpt-actions">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => onInsert(formatQuoteCiteClipboard(quote, paper.title))}
                >
                  Insert
                </button>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(formatQuoteCiteClipboard(quote, paper.title))
                      .catch(() => setError("Clipboard unavailable"));
                  }}
                >
                  Copy
                </button>
                {annotation.key && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      void papersFacadeUnpin(paper.id, annotation.key!, reload, setError);
                    }}
                  >
                    Unpin
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

async function papersFacadeUnpin(
  paperId: string,
  annotationKey: string,
  reload: () => Promise<void>,
  setError: (message: string | null) => void,
) {
  try {
    await getContainer().papers.setAnnotationPin(paperId, annotationKey, null);
    await reload();
  } catch (reason) {
    setError(reason instanceof Error ? reason.message : String(reason));
  }
}
