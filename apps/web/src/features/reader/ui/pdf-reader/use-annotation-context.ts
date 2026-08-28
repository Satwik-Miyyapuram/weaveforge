"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReaderAnnotation } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import {
  findAnnotationBacklinks,
  type AnnotationBacklinkHit,
} from "../../application/annotation-backlinks";
import type { ReportSectionOption } from "../annotation-sidebar";

/** One row of the pin table: which annotation is pinned to which section. */
export interface AnnotationPin {
  annotationKey: string;
  reportSectionId: string;
  paperId: string;
}

export interface AnnotationContext {
  reportSections: ReportSectionOption[];
  /** Section per annotation key, for the sidebar's pin control. */
  pinsByKey: Map<string, string | null>;
  /**
   * Record a pin locally after it has been written.
   *
   * Both the map the sidebar reads and the list the backlinks are derived from
   * have to move together; a caller that updated one of them left the other
   * disagreeing until the next load.
   */
  applyPin: (annotationKey: string, sectionId: string | null, paperId: string) => void;
  backlinkHits: AnnotationBacklinkHit[];
}

/**
 * Everything around an annotation that lives outside the PDF: the report
 * sections it can be pinned to, the pins themselves, and the notes and sections
 * that already quote it.
 *
 * Lifted out of the reader because none of it touches rendering — it is loaded
 * once per paper, derived when the annotation list changes, and read only by
 * the sidebar. The pin map is returned with its setter so a pin can be applied
 * optimistically by the caller that writes it.
 */
export function useAnnotationContext(
  paperId: string | undefined,
  annotations: readonly ReaderAnnotation[],
): AnnotationContext {
  const [reportSections, setReportSections] = useState<ReportSectionOption[]>([]);
  const [pinsByKey, setPinsByKey] = useState<Map<string, string | null>>(new Map());
  const [pinsList, setPinsList] = useState<AnnotationPin[]>([]);
  const [backlinkHits, setBacklinkHits] = useState<AnnotationBacklinkHit[]>([]);
  const [vaultBacklinkPages, setVaultBacklinkPages] = useState<
    { id: string; title: string; body: string }[]
  >([]);

  useEffect(() => {
    if (!paperId) {
      setReportSections([]);
      setPinsByKey(new Map());
      setPinsList([]);
      setVaultBacklinkPages([]);
      setBacklinkHits([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [sections, pins, vaultPages] = await Promise.all([
          getContainer().papers.listReportSections(),
          getContainer().papers.listAnnotationPinsForPaper(paperId),
          getContainer().vault.listPages().catch(() => []),
        ]);
        if (cancelled) return;
        setReportSections(
          sections.map((s) => ({ id: s.id, title: s.title || "Untitled section" })),
        );
        setPinsByKey(new Map(pins.map((p) => [p.annotationKey, p.reportSectionId])));
        setPinsList(
          pins.map((p) => ({
            annotationKey: p.annotationKey,
            reportSectionId: p.reportSectionId,
            paperId: p.paperId,
          })),
        );
        setVaultBacklinkPages(
          vaultPages.map((p) => ({
            id: p.id,
            title: p.title || "Untitled note",
            body: p.body ?? "",
          })),
        );
      } catch {
        if (!cancelled) {
          setReportSections([]);
          setPinsByKey(new Map());
          setPinsList([]);
          setVaultBacklinkPages([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paperId]);

  useEffect(() => {
    if (!paperId) {
      setBacklinkHits([]);
      return;
    }
    setBacklinkHits(
      findAnnotationBacklinks({
        annotations,
        pins: pinsList,
        sections: reportSections,
        vaultPages: vaultBacklinkPages,
      }),
    );
  }, [paperId, annotations, pinsList, reportSections, vaultBacklinkPages]);

  const applyPin = useCallback(
    (annotationKey: string, sectionId: string | null, forPaper: string) => {
      setPinsByKey((prev) => {
        const next = new Map(prev);
        if (sectionId) next.set(annotationKey, sectionId);
        else next.delete(annotationKey);
        return next;
      });
      setPinsList((prev) => {
        const without = prev.filter((pin) => pin.annotationKey !== annotationKey);
        if (!sectionId) return without;
        return [...without, { annotationKey, reportSectionId: sectionId, paperId: forPaper }];
      });
    },
    [],
  );

  return { reportSections, pinsByKey, applyPin, backlinkHits };
}
