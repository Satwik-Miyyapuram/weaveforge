/**
 * Creating a mark leaves nothing selected: a fresh highlight wearing the
 * selection box read as stuck, and the next tap went to dismissing it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { NewReaderAnnotation, ReaderAnnotation } from "@weaveforge/core";

import { useAnnotationActions, type AnnotationActions } from "../ui/pdf-reader/use-annotation-actions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { window?: unknown }).window ??= { getSelection: () => null };

test("persistDraft never selects the mark it creates", async () => {
  let selected: string | null = null;
  const setSelectedAnnId = (update: string | null | ((prev: string | null) => string | null)) => {
    selected = typeof update === "function" ? update(selected) : update;
    seen.push(selected);
  };
  const seen: (string | null)[] = [];
  let rows: ReaderAnnotation[] = [];
  let actions: AnnotationActions | null = null;
  function Probe() {
    actions = useAnnotationActions({
      paperId: "paper-1",
      onAnnotationsChange: (next) => {
        rows = typeof next === "function" ? next(rows) : next;
      },
      onActivity: undefined,
      applyPin: () => {},
      selectedAnnId: null,
      setSelectedAnnId,
      clearPendingCreate: () => {},
    });
    return null;
  }
  act(() => {
    create(createElement(Probe));
  });
  const draft = {
    type: "highlight",
    color: "#ffd400",
    pageIndex: 0,
    position: { pageIndex: 0, rects: [[0, 0, 10, 10]] },
    text: "words",
  } as unknown as NewReaderAnnotation;
  // No container in a test: the write fails and rolls back, which is the
  // path that once selected the optimistic row before it vanished.
  await act(async () => {
    await actions!.persistDraft(draft);
  });
  assert.deepEqual(
    seen.filter((id) => id !== null),
    [],
  );
  assert.equal(selected, null);
});
