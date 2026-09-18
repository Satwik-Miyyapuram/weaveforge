"use client";

import { useEffect, useRef, useState } from "react";
import type { ReaderOutlineItem } from "@weaveforge/core";
import {
  buildReferenceIndex,
  type ReaderReferenceIndex,
  type ReferencePage,
} from "../../application/reader-references";
import type {
  AnalysisRequest,
  AnalysisResponse,
  AnalysisWorkerPage,
} from "../../infrastructure/analysis.worker";

const EMPTY_INDEX: ReaderReferenceIndex = {
  references: [],
  byIndex: new Map(),
  mentionsByPage: new Map(),
  bodyFontSize: 0,
  fingerprint: "",
};

let workerInstance: Worker | null = null;
let currentRequestId = 1;

function getWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    workerInstance ??= new Worker(
      new URL("../../infrastructure/analysis.worker.ts", import.meta.url),
    );
    return workerInstance;
  } catch {
    return null;
  }
}

export interface UseDocumentAnalyzerInput {
  pages: readonly ReferencePage[];
  outline: readonly ReaderOutlineItem[];
  enabled?: boolean;
}

export interface DocumentAnalyzerResult {
  index: ReaderReferenceIndex;
  progress: number; // 0 - 100
  isAnalyzing: boolean;
}

export function useDocumentAnalyzer({
  pages,
  outline,
  enabled = true,
}: UseDocumentAnalyzerInput): DocumentAnalyzerResult {
  const [index, setIndex] = useState<ReaderReferenceIndex>(EMPTY_INDEX);
  const [progress, setProgress] = useState<number>(0);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const activeId = useRef<number>(0);

  useEffect(() => {
    if (!enabled || !pages.length) {
      setIndex(EMPTY_INDEX);
      setProgress(0);
      setIsAnalyzing(false);
      return;
    }

    const id = ++currentRequestId;
    activeId.current = id;
    setIsAnalyzing(true);
    setProgress(5);

    const worker = getWorker();

    if (!worker) {
      // In-thread fallback if Worker is not available in environment
      try {
        const fallback = buildReferenceIndex(pages, outline);
        if (activeId.current === id) {
          setIndex(fallback);
          setProgress(100);
          setIsAnalyzing(false);
        }
      } catch {
        if (activeId.current === id) {
          setIsAnalyzing(false);
        }
      }
      return;
    }

    const workerPages: AnalysisWorkerPage[] = pages.map((page) => ({
      pageNumber: page.pageNumber,
      items: [...page.items],
      links: [...(page.links ?? [])],
    }));

    const handleMessage = (event: MessageEvent<AnalysisResponse>) => {
      const data = event.data;
      if (!data || data.id !== id || activeId.current !== id) return;

      if (data.type === "progress") {
        setProgress(data.percent);
      } else if (data.type === "complete") {
        setIndex({
          references: data.references,
          byIndex: new Map(data.references.map((r) => [r.index, r])),
          mentionsByPage: new Map(data.mentionsByPage),
          bodyFontSize: data.bodyFontSize,
          fingerprint: data.fingerprint,
        });
        setProgress(100);
        setIsAnalyzing(false);
        cleanup();
      } else if (data.type === "error") {
        // Fall back to in-thread calculation on worker error
        try {
          const fallback = buildReferenceIndex(pages, outline);
          setIndex(fallback);
        } catch {
          /* ignore */
        }
        setProgress(100);
        setIsAnalyzing(false);
        cleanup();
      }
    };

    const handleError = () => {
      if (activeId.current !== id) return;
      try {
        const fallback = buildReferenceIndex(pages, outline);
        setIndex(fallback);
      } catch {
        /* ignore */
      }
      setProgress(100);
      setIsAnalyzing(false);
      cleanup();
    };

    const cleanup = () => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);

    worker.postMessage({
      id,
      pages: workerPages,
      outline: [...outline],
    } satisfies AnalysisRequest);

    return () => {
      cleanup();
    };
  }, [pages, outline, enabled]);

  return { index, progress, isAnalyzing };
}
