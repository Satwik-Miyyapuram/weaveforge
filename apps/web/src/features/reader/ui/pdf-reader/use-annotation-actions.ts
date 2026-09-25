"use client";

import { useCallback, useState } from "react";
import type { NewReaderAnnotation, ReaderAnnotation } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import {
  annotationPinKey,
  applyAnnotationPatch,
  optimisticAnnotationFromDraft,
  PENDING_ANNOTATION_PREFIX,
} from "../../application/reader-annotation-helpers";
import type { PdfReaderProps } from "./types";

type ChangeAnnotations = NonNullable<PdfReaderProps["onAnnotationsChange"]>;

export interface AnnotationActionsDeps {
  paperId: string | undefined;
  onAnnotationsChange: PdfReaderProps["onAnnotationsChange"];
  onActivity: PdfReaderProps["onActivity"];
  /** Record a pin locally once it is written; see `useAnnotationContext`. */
  applyPin: (annotationKey: string, sectionId: string | null, paperId: string) => void;
  selectedAnnId: string | null;
  setSelectedAnnId: (update: string | null | ((prev: string | null) => string | null)) => void;
  /** Drop the pending text selection once a draft is on its way. */
  clearPendingCreate: () => void;
}

export interface AnnotationActions {
  /** The last write that failed, for the banner. Null while nothing is wrong. */
  annError: string | null;
  setAnnError: (message: string | null) => void;
  /** A create is in flight; the create bar disables itself on it. */
  createBusy: boolean;
  /** Returns the persisted annotation, or null when the write failed. */
  persistDraft: (draft: NewReaderAnnotation) => Promise<ReaderAnnotation | null>;
  updateLocal: (
    id: string,
    patch: { comment?: string; tags?: string[]; color?: string },
  ) => Promise<void>;
  /** Delete now, no question asked. Every caller that needs one goes through `askRemove`. */
  removeLocal: (id: string) => Promise<void>;
  /**
   * Open the app's own confirmation for a delete. The reader draws the dialog —
   * a hook cannot — so this only names the annotation being asked about.
   */
  askRemove: (id: string) => void;
  /** The annotation a confirmation is open for, or null when none is. */
  pendingRemove: string | null;
  clearPendingRemove: () => void;
  pinLocal: (ann: ReaderAnnotation, sectionId: string | null) => Promise<void>;
  saveAnchor: (ann: ReaderAnnotation, anchor: ReaderAnnotation["anchor"]) => Promise<void>;
}

/**
 * Every write the reader makes to an annotation.
 *
 * All of them follow one rule: paint the change, then persist it, then
 * reconcile. A write is a network round-trip, and waiting for it left the
 * reader looking dead for hundreds of milliseconds after a click. Each write
 * therefore also owns its rollback, which is why they are kept together rather
 * than beside the drawing code that calls them.
 */
export function useAnnotationActions({
  paperId,
  onAnnotationsChange,
  onActivity,
  applyPin,
  selectedAnnId,
  setSelectedAnnId,
  clearPendingCreate,
}: AnnotationActionsDeps): AnnotationActions {
  const [annError, setAnnError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  const persistDraft = useCallback(
    async (draft: NewReaderAnnotation): Promise<ReaderAnnotation | null> => {
      if (!paperId || !onAnnotationsChange) return null;
      const change: ChangeAnnotations = onAnnotationsChange;

      const tempId = `${PENDING_ANNOTATION_PREFIX}${
        globalThis.crypto?.randomUUID?.() ?? String(Date.now())
      }`;
      const optimistic = optimisticAnnotationFromDraft(draft, tempId);
      change((prev) => [...prev, optimistic]);
      /**
       * Ink is not selected on creation, and everything else is.
       *
       * A highlight or a note is a row you have just made and may want to
       * comment on, so it opens selected. A pen stroke is not: a hand writing
       * does not want the mark it has just made picked up — the sheet never
       * picks up what was just written — and a selected stroke wears the
       * selection halo, so selecting every new one frames the whole page in
       * them. Tapping a mark with the pointer tool, or its row in the list,
       * still selects it.
       */
      if (draft.type !== "ink") setSelectedAnnId(tempId);
      clearPendingCreate();
      setAnnError(null);
      window.getSelection()?.removeAllRanges();

      setCreateBusy(true);
      try {
        const created = await getContainer().papers.createReaderAnnotation(paperId, draft);
        change((prev) => prev.map((a) => (a.id === tempId ? created : a)));
        setSelectedAnnId((prev) => (prev === tempId ? created.id : prev));
        onActivity?.("annotate", `Created ${created.type}`);
        return created;
      } catch (err) {
        // Roll the optimistic one back — leaving it would show a highlight that
        // vanishes on the next reload with no explanation.
        change((prev) => prev.filter((a) => a.id !== tempId));
        setSelectedAnnId((prev) => (prev === tempId ? null : prev));
        setAnnError(err instanceof Error ? err.message : "Could not save the annotation.");
        return null;
      } finally {
        setCreateBusy(false);
      }
    },
    [paperId, onAnnotationsChange, onActivity, setSelectedAnnId, clearPendingCreate],
  );

  const updateLocal = useCallback(
    async (id: string, patch: { comment?: string; tags?: string[]; color?: string }) => {
      if (!onAnnotationsChange) return;
      const change: ChangeAnnotations = onAnnotationsChange;
      // A colour change repaints the highlight, so waiting for the write shows a
      // swatch that stays wrong until the network answers. Apply, then reconcile.
      let previous: ReaderAnnotation | undefined;
      change((prev) =>
        prev.map((a) => {
          if (a.id !== id) return a;
          previous = a;
          return applyAnnotationPatch(a, patch);
        }),
      );
      setAnnError(null);
      try {
        const updated = await getContainer().papers.updateReaderAnnotation(id, patch);
        change((prev) => prev.map((a) => (a.id === id ? updated : a)));
        onActivity?.("annotate", "Updated annotation");
      } catch (err) {
        if (previous) {
          const restore = previous;
          change((prev) => prev.map((a) => (a.id === id ? restore : a)));
        }
        setAnnError(err instanceof Error ? err.message : "Could not update the annotation.");
      }
    },
    [onAnnotationsChange, onActivity],
  );

  /**
   * Delete a local annotation. No confirmation lives here any more.
   *
   * This used to call `window.confirm` unless the caller passed
   * `{ confirm: false }`, which left the reader with an unstyled OS dialog in
   * the middle of a themed surface — the exact thing `ConfirmDialog` exists to
   * replace, and the last call site of it outside the two error boundaries
   * (which keep the platform dialog on purpose: they may be rendering because
   * the tree that draws `Modal` is what failed).
   *
   * A hook cannot render a dialog, so the question moved to the caller: the
   * paths a person chooses — the sidebar's Delete button and the Delete key on
   * a selected mark — go through `askRemove`, which names the annotation and
   * lets `pdf-reader.tsx` draw `ConfirmDialog` over it. The paths that are
   * already deliberate gestures — the eraser, ink undo — call this directly,
   * which is what they asked for before by passing `confirm: false`.
   */
  const removeLocal = useCallback(
    async (id: string) => {
      if (!onAnnotationsChange) return;
      const change: ChangeAnnotations = onAnnotationsChange;
      let removed: ReaderAnnotation | undefined;
      change((prev) => {
        removed = prev.find((a) => a.id === id);
        return prev.filter((a) => a.id !== id);
      });
      if (selectedAnnId === id) setSelectedAnnId(null);
      setAnnError(null);
      try {
        await getContainer().papers.removeReaderAnnotation(id);
        onActivity?.("annotate", "Deleted annotation");
      } catch (err) {
        if (removed) {
          const restore = removed;
          change((prev) => (prev.some((a) => a.id === restore.id) ? prev : [...prev, restore]));
        }
        setAnnError(err instanceof Error ? err.message : "Could not delete the annotation.");
      }
    },
    [onAnnotationsChange, onActivity, selectedAnnId, setSelectedAnnId],
  );

  const askRemove = useCallback((id: string) => setPendingRemove(id), []);
  const clearPendingRemove = useCallback(() => setPendingRemove(null), []);

  const pinLocal = useCallback(
    async (ann: ReaderAnnotation, sectionId: string | null) => {
      if (!paperId) return;
      const key = annotationPinKey(ann);
      try {
        await getContainer().papers.setAnnotationPin(paperId, key, sectionId);
        applyPin(key, sectionId, paperId);
        setAnnError(null);
      } catch (err) {
        setAnnError(err instanceof Error ? err.message : "Could not pin the annotation.");
      }
    },
    [paperId, applyPin],
  );

  const saveAnchor = useCallback(
    async (ann: ReaderAnnotation, anchor: ReaderAnnotation["anchor"]) => {
      if (!onAnnotationsChange) return;
      const change: ChangeAnnotations = onAnnotationsChange;
      const previous = ann.anchor;
      change((prev) => prev.map((a) => (a.id === ann.id ? { ...a, anchor } : a)));
      setAnnError(null);
      try {
        const updated = await getContainer().papers.updateReaderAnnotation(ann.id, { anchor });
        change((prev) => prev.map((a) => (a.id === ann.id ? updated : a)));
      } catch (err) {
        change((prev) => prev.map((a) => (a.id === ann.id ? { ...a, anchor: previous } : a)));
        setAnnError(err instanceof Error ? err.message : "Could not move the annotation.");
      }
    },
    [onAnnotationsChange],
  );

  return {
    annError,
    setAnnError,
    createBusy,
    persistDraft,
    updateLocal,
    removeLocal,
    askRemove,
    pendingRemove,
    clearPendingRemove,
    pinLocal,
    saveAnchor,
  };
}
