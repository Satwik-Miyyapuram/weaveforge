"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Paper, ReportSection } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { formatQuoteCiteClipboard } from "@/features/papers/application/sync-annotation-excerpts";
import { formatError } from "@/lib/format-error";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/button";

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
      setError(formatError(reason));
    });
    return () => {
      cancelled = true;
      loadGeneration.current += 1;
    };
  }, [reload]);

  // Folded while empty, so a section without pins is one line beside the note,
  // not a permanent box; open once something is pinned.
  return (
    <details className="section-excerpts" aria-label="Related annotations" open={items.length > 0}>
      <summary className="section-excerpts-title">
        Zotero annotations <span className="muted">({items.length})</span>
      </summary>
      {error && <FormError>{error}</FormError>}
      {items.length === 0 ? (
        <p className="muted section-excerpts-empty">No Zotero annotations pinned to this section.</p>
      ) : (
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
                  <Button variant="link"
                    onClick={() => onInsert(formatQuoteCiteClipboard(quote, paper.title))}
                  >
                    Insert
                  </Button>
                  <Button
                   
                    variant="ghost" size="sm"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(formatQuoteCiteClipboard(quote, paper.title))
                        .catch(() => setError("Clipboard unavailable"));
                    }}
                  >
                    Copy
                  </Button>
                  {annotation.key && (
                    <Button variant="link"
                      onClick={() => {
                        void papersFacadeUnpin(paper.id, annotation.key!, reload, setError);
                      }}
                    >
                      Unpin
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </details>
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
    setError(formatError(reason));
  }
}
