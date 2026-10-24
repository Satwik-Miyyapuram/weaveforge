"use client";

/**
 * Recognition, per page, on demand (§5 as the user sees it).
 *
 * The page model comes from the worker; `recognisePage` runs it through the
 * session's engine with the workspace's vocabulary; the segmented page goes
 * back to the worker with `replace-page`, and the lines land in the text
 * column. A correction in the column marks a line certain and is saved the
 * same way. The host owns the pen and the worker; this owns the flow and the
 * state it reads: the recognised page, the progress line, and the message
 * that says why nothing can run.
 */

import { useCallback, useRef, useState } from "react";
import {
  inkPageBackground,
  inkPageFigures,
  withInkPageBackground,
  withInkPageFigures,
  type InkNoteMeta,
  type InkPage as InkPageModel,
  type InkRecogniser,
  type InkRecognitionHints,
} from "@weaveforge/core";

import {
  acceptLine,
  recognisePage,
  recognisedPageFromModel,
  type RecognisedPage,
} from "../application/recognise-page";
import { messageOf } from "./error-message";

/** What the flow needs from the host; the host owns the worker and the saves. */
export interface InkRecognitionDeps {
  /** The engine, or `null` where none can run. */
  recogniser: () => Promise<InkRecogniser | null>;
  /** The workspace's vocabulary and shapes. */
  hints: () => Promise<InkRecognitionHints>;
  /** The worker's strokes for the current page. */
  requestModel: () => Promise<InkPageModel>;
  /** Tell the worker the recognised page `pageIndex`, geometry replaced. */
  sendReplace: (page: InkPageModel, pageIndex: number) => void;
  /** The note's header, kept by the host; recognition writes two fields of it. */
  metaRef: { current: InkNoteMeta };
  /** The pages' text layers, written with the recognised text. */
  textPagesRef: { current: string[] };
  /** 0-based: the page being recognised. */
  pageIndex: number;
  /** The late, coalesced save. */
  scheduleSave: () => void;
}

/** The message the text column shows where no engine can run. */
export const INK_NO_ENGINE_MESSAGE =
  "No handwriting engine is available here. The desktop app on Windows recognises offline through the operating system's own analyser; the built-in stroke model is not shipped in this build.";

export function useInkRecognition(deps: InkRecognitionDeps) {
  const {
    recogniser,
    hints,
    requestModel,
    sendReplace,
    metaRef,
    textPagesRef,
    pageIndex,
    scheduleSave,
  } = deps;

  const [recognised, setRecognised] = useState<RecognisedPage | null>(null);
  const [recognising, setRecognising] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const recognisedRef = useRef<RecognisedPage | null>(null);
  recognisedRef.current = recognised;
  // The page on screen now, for a recognition that started on another (21-01).
  const pageIndexRef = useRef(pageIndex);
  pageIndexRef.current = pageIndex;

  /** A page the worker just loaded: its earlier run's lines, if it has any. */
  const onModelLoaded = useCallback(
    (model: InkPageModel, engine: InkNoteMeta["engine"]) => {
      setRecognised(
        model.lines.length > 0 ? recognisedPageFromModel(model, engine) : null,
      );
    },
    [],
  );

  /**
   * The page being left, forgotten now rather than when the next one's model
   * arrives: the column between two pages never shows the old page's lines.
   */
  const reset = useCallback(() => {
    setRecognised(null);
  }, []);

  /**
   * A recognised page becomes the worker's page, the column's lines and the
   * body's text. Recognition replaces the page's text; the background line
   * and the figures are the host's, so both are re-applied over the new text.
   * A result for a page the reader has left only writes that page's text: the
   * worker and the column now hold another page (21-01).
   */
  const applyRecognised = useCallback(
    (result: RecognisedPage, at: number) => {
      if (at === pageIndexRef.current) {
        sendReplace(result.page, at);
        setRecognised(result);
      }
      const was = textPagesRef.current[at] ?? "";
      textPagesRef.current[at] = withInkPageFigures(
        withInkPageBackground(result.text, inkPageBackground(was)),
        inkPageFigures(was),
      );
      metaRef.current = {
        ...metaRef.current,
        recognised: result.confidence,
        engine: result.engine || metaRef.current.engine,
      };
      scheduleSave();
    },
    [metaRef, scheduleSave, sendReplace, textPagesRef],
  );

  /** Recognise this page: the engine, line by line, then the post-match (§5.4). */
  const recognise = useCallback(async () => {
    if (recognising) return;
    const at = pageIndex;
    setRecognising(true);
    setProgress(null);
    try {
      const engine = await recogniser();
      if (!engine) {
        setUnavailable(INK_NO_ENGINE_MESSAGE);
        return;
      }
      setUnavailable(null);
      const [model, workspaceHints] = await Promise.all([
        requestModel(),
        hints(),
      ]);
      const result = await recognisePage({
        page: model,
        recogniser: engine,
        hints: workspaceHints,
        onProgress: (done, total) => setProgress(`line ${done} of ${total}`),
      });
      applyRecognised(result, at);
    } catch (error) {
      setUnavailable(messageOf(error));
    } finally {
      setRecognising(false);
      setProgress(null);
    }
  }, [applyRecognised, hints, pageIndex, recognising, recogniser, requestModel]);

  /** A correction from the column: certain from now on. */
  const onAccept = useCallback(
    (index: number, text: string) => {
      const current = recognisedRef.current;
      if (!current) return;
      applyRecognised(acceptLine(current, index, text), pageIndexRef.current);
    },
    [applyRecognised],
  );

  return {
    recognised,
    recognising,
    progress,
    unavailable,
    setUnavailable,
    onModelLoaded,
    reset,
    recognise,
    onAccept,
  };
}
