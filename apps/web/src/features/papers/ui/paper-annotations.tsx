"use client";

import { useCallback, useEffect, useState } from "react";
import { QUOTATION_TYPES, QUOTATION_TYPE_LABELS, type Paper, type QuotationType } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { formatError } from "@/lib/format-error";
import { Select } from "@/components/select";
import { formatQuoteCiteClipboard } from "@/features/papers/application/sync-annotation-excerpts";

interface StoredAnnotation {
  key?: string;
  kind?: "annotation" | "note";
  text?: string;
  comment?: string;
  color?: string;
  page?: string;
  tags?: string[];
}

/** Read-only list of Zotero PDF annotations cached on the paper (metadata.annotations). */
export function PaperAnnotations({ paper, readOnly }: { paper: Paper; readOnly: boolean }) {
  const anns = (paper.metadata?.["annotations"] as StoredAnnotation[] | undefined) ?? [];
  const [msg, setMsg] = useState<string | null>(null);
  const [sections, setSections] = useState<{ id: string; title: string }[]>([]);
  const [pins, setPins] = useState<Map<string, string>>(new Map());
  const [quotationTypes, setQuotationTypes] = useState<Map<string, QuotationType>>(new Map());
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const reloadPins = useCallback(async () => {
    const papers = getContainer().papers;
    const [availableSections, currentPins, currentTypes] = await Promise.all([
      papers.listReportSections(),
      papers.listAnnotationPinsForPaper(paper.id),
      papers.listAnnotationQuotationTypesForPaper(paper.id),
    ]);
    setSections(availableSections.map(({ id, title }) => ({ id, title })));
    setPins(new Map(currentPins.map((pin) => [pin.annotationKey, pin.reportSectionId])));
    setQuotationTypes(
      new Map(currentTypes.map((row) => [row.annotationKey, row.quotationType])),
    );
  }, [paper.id]);

  useEffect(() => {
    let cancelled = false;
    void reloadPins().catch((error) => {
      if (!cancelled) setMsg(formatError(error));
    });
    return () => {
      cancelled = true;
    };
  }, [reloadPins]);

  if (anns.length === 0) return null;

  const pageAnnotations = anns.filter((a) => a.kind !== "note");
  const zoteroNotes = anns.filter((a) => a.kind === "note");

  async function copyCite(a: StoredAnnotation) {
    const quote = (a.text ?? a.comment ?? "").trim();
    if (!quote) return;
    try {
      await navigator.clipboard.writeText(formatQuoteCiteClipboard(quote, paper.title));
      setMsg("Copied quote + [[cite]]");
      window.setTimeout(() => setMsg(null), 1500);
    } catch {
      setMsg("Clipboard unavailable");
    }
  }

  async function setPin(annotationKey: string, sectionId: string | null) {
    setBusyKey(annotationKey);
    setMsg(null);
    try {
      await getContainer().papers.setAnnotationPin(paper.id, annotationKey, sectionId);
      await reloadPins();
    } catch (error) {
      setMsg(formatError(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function setQuotationType(annotationKey: string, value: string) {
    setBusyKey(annotationKey);
    setMsg(null);
    try {
      const next = value ? (value as QuotationType) : null;
      await getContainer().papers.setAnnotationQuotationType(paper.id, annotationKey, next);
      await reloadPins();
    } catch (error) {
      setMsg(formatError(error));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="annotations">
      {msg && <div className="muted annotations-head">{msg}</div>}
      {pageAnnotations.length > 0 && (
        <>
          <div className="muted annotations-head">
            Annotations ({pageAnnotations.length}) · read-only, synced from Zotero
          </div>
          <ul className="annotation-list">
            {pageAnnotations.map((a, i) => (
              <li key={a.key ?? `ann-${i}`} className="annotation">
                {a.color && (
                  <span className="annotation-swatch" style={{ background: a.color }} aria-hidden />
                )}
                <div className="annotation-body">
                  {a.key && quotationTypes.get(a.key) && (
                    <span className="annotation-quote-type muted">
                      {QUOTATION_TYPE_LABELS[quotationTypes.get(a.key)!]}
                    </span>
                  )}
                  {a.text && <p className="annotation-text">{a.text}</p>}
                  {a.comment && <p className="annotation-comment">{a.comment}</p>}
                  {a.page && <p className="muted">p.{a.page}</p>}
                  {a.tags && a.tags.length > 0 && (
                    <div className="tag-chips">
                      {a.tags.map((t) => (
                        <span key={t} className="tag-chip">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                  {(a.text || a.comment) && (
                    <div className="annotation-actions">
                      <button type="button" className="link-btn" onClick={() => void copyCite(a)}>
                        Copy quote + cite
                      </button>
                      {a.key && !readOnly && (
                        <>
                          <Select
                            className="annotation-quote-select"
                            aria-label="Quotation type"
                            value={quotationTypes.get(a.key) ?? ""}
                            disabled={busyKey === a.key}
                            onChange={(event) => void setQuotationType(a.key!, event.target.value)}
                          >
                            <option value="">Quotation type</option>
                            {QUOTATION_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {QUOTATION_TYPE_LABELS[type]}
                              </option>
                            ))}
                          </Select>
                          <Select
                            className="annotation-pin-select"
                            aria-label="Pin annotation to report section"
                            value={pins.get(a.key) ?? ""}
                            disabled={busyKey === a.key}
                            onChange={(event) => void setPin(a.key!, event.target.value || null)}
                          >
                            <option value="">Unpinned</option>
                            {sections.map((section) => (
                              <option key={section.id} value={section.id}>
                                {section.title}
                              </option>
                            ))}
                          </Select>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {zoteroNotes.length > 0 && (
        <>
          <div className="muted annotations-head">
            Notes from Zotero ({zoteroNotes.length}) · read-only
          </div>
          <ul className="annotation-list">
            {zoteroNotes.map((a, i) => (
              <li key={a.key ?? `note-${i}`} className="annotation">
                <div className="annotation-body">
                  {a.text && <p className="annotation-text">{a.text}</p>}
                  {a.comment && <p className="annotation-comment">{a.comment}</p>}
                  {a.tags && a.tags.length > 0 && (
                    <div className="tag-chips">
                      {a.tags.map((t) => (
                        <span key={t} className="tag-chip">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                  {(a.text || a.comment) && (
                    <div className="annotation-actions">
                      <button type="button" className="link-btn" onClick={() => void copyCite(a)}>
                        Copy quote + cite
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
