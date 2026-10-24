"use client";

import { useEffect, useRef, useState } from "react";
import { analyzePdfDocument, type DocumentAnalysis, type ReaderOutlineItem } from "@weaveforge/core";
import { logToApp } from "@/lib/error-report/app-log";
import { describeRejection } from "@/lib/format-error";
import {
  indexFromAnalysis,
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

const EMPTY_ANALYSIS: DocumentAnalysis = {
  pages: [],
  sections: [],
  references: [],
  citations: [],
  figures: [],
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
}

/**
 * The analysis and its index, computed here when there is no worker or the
 * worker failed: one analysis pass yields both. Null (and logged) on failure.
 */
export function analyzeInThread(
  pages: readonly ReferencePage[],
  outline: readonly ReaderOutlineItem[],
): { analysis: DocumentAnalysis; index: ReaderReferenceIndex } | null {
  try {
    const analysis = analyzePdfDocument(
      pages.map((page) => ({ pageNumber: page.pageNumber, items: page.items, links: page.links ?? [] })),
      outline,
    );
    return { analysis, index: indexFromAnalysis(analysis, pages) };
  } catch (err) {
    logToApp({
      level: "warn",
      source: "reader",
      message: "Document analysis failed; citations are not linked",
      detail: err instanceof Error ? (err.stack ?? describeRejection(err)) : describeRejection(err),
    });
    return null;
  }
}

export interface DocumentAnalyzerResult {
  /** The overlay-shaped index derived from the analysis. */
  index: ReaderReferenceIndex;
  /** The structured analysis itself — sections, entries, citations, figures. */
  analysis: DocumentAnalysis;
  progress: number; // 0 - 100
  isAnalyzing: boolean;
}

/**
 * Runs the full document analysis off the main thread and hands back both the
 * raw `DocumentAnalysis` (plain arrays, straight from the worker) and the
 * overlay index derived from it. Without a worker, the same analysis runs
 * in-thread, so both paths agree about what is on a page.
 */
export function useDocumentAnalyzer({
  pages,
  outline,
}: UseDocumentAnalyzerInput): DocumentAnalyzerResult {
  const [index, setIndex] = useState<ReaderReferenceIndex>(EMPTY_INDEX);
  const [analysis, setAnalysis] = useState<DocumentAnalysis>(EMPTY_ANALYSIS);
  const [progress, setProgress] = useState<number>(0);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const activeId = useRef<number>(0);

  // Start the worker while the PDF is still being read, so the first
  // analysis does not also pay for spawning it and loading its bundle.
  useEffect(() => {
    getWorker();
  }, []);

  useEffect(() => {
    if (!pages.length) {
      setIndex(EMPTY_INDEX);
      setAnalysis(EMPTY_ANALYSIS);
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
      // No Worker in this environment: analyse here.
      const result = analyzeInThread(pages, outline);
      if (activeId.current === id) {
        if (result) {
          setIndex(result.index);
          setAnalysis(result.analysis);
          setProgress(100);
        }
        setIsAnalyzing(false);
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
        setAnalysis(data.analysis);
        setIndex(indexFromAnalysis(data.analysis, pages));
        setProgress(100);
        setIsAnalyzing(false);
        cleanup();
      } else if (data.type === "error") {
        // Fall back to in-thread calculation on worker error
        fallBack();
        setProgress(100);
        setIsAnalyzing(false);
        cleanup();
      }
    };

    const handleError = () => {
      if (activeId.current !== id) return;
      fallBack();
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

    function fallBack(): void {
      const result = analyzeInThread(pages, outline);
      if (!result) return;
      setIndex(result.index);
      setAnalysis(result.analysis);
    }
  }, [pages, outline]);

  return { index, analysis, progress, isAnalyzing };
}
