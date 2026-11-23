/**
 * An undo ends the mark in progress. Strokes in one breath join one mark from
 * the anchor the pen last saved (`groupAnchor`); after an undo that anchor is
 * stale, and the next stroke joined onto it brought the undone stroke back.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { ReaderAnnotation } from "@weaveforge/core";
import type { CombinedPdfAnchor } from "@weaveforge/wasm";

import { loadTestCore } from "@/lib/test/load-test-core";
import { renderHook } from "@/lib/test/react-harness";
import { usePagePointer, type PagePointerDeps } from "../ui/pdf-reader/use-page-pointer";
import { useInkUndo } from "../ui/pdf-reader/use-ink-undo";

before(loadTestCore);

const g = globalThis as unknown as { window?: unknown };
const previousWindow = g.window;
before(() => {
  g.window ??= globalThis;
});
after(() => {
  g.window = previousWindow;
});

function row(id: string, anchor: CombinedPdfAnchor): ReaderAnnotation {
  return {
    id,
    origin: "local",
    type: "ink",
    color: "#ff0000",
    text: "",
    comment: "",
    tags: [],
    sortIndex: "00000|000000|00000",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    anchor,
  } as unknown as ReaderAnnotation;
}

const stroke = (x: number) => ({ pageNumber: 1, pageHeight: 800, path: [x, 100, x + 10, 120, x + 20, 140], width: 2 });

/** The reader's store: rows by id, written by the raw actions. */
function store() {
  let rows: ReaderAnnotation[] = [];
  let next = 0;
  const writes = {
    persistDraft: async (draft: { id?: string; anchor: CombinedPdfAnchor }) => {
      const created = row(draft.id ?? `a${++next}`, draft.anchor);
      rows = [...rows.filter((r) => r.id !== created.id), created];
      return created;
    },
    removeLocal: async (id: string) => {
      rows = rows.filter((r) => r.id !== id);
      return true;
    },
    saveAnchor: async (ann: ReaderAnnotation, anchor: CombinedPdfAnchor) => {
      rows = rows.map((r) => (r.id === ann.id ? { ...r, anchor } : r));
      return true;
    },
  };
  return { writes, rows: () => rows };
}

test("a stroke after an undo does not bring the undone stroke back", async () => {
  const s = store();
  const useReader = ({ rows }: { rows: ReaderAnnotation[] }) => {
    const undo = useInkUndo(s.writes as never, rows);
    const pointer = usePagePointer({
      canCreate: true,
      createTool: "ink",
      createColor: "#ff0000",
      inkEditable: true,
      selectedAnnId: null,
      pageSize: { width: 600, height: 800 },
      scale: 1,
      rotation: 0,
      pageGeometries: { current: new Map() },
      annotations: rows,
      annotationsByPage: new Map([[1, rows]]),
      persistDraft: undo.persistDraft,
      removeLocal: undo.removeLocal,
      saveAnchor: undo.saveAnchor,
      inkUndoSteps: undo.steps,
    } as unknown as PagePointerDeps);
    return { undo, pointer };
  };
  const h = await renderHook(useReader, { rows: s.rows() });
  const sync = () => h.rerender({ rows: s.rows() });

  await h.current.pointer.persistInkStroke(stroke(100));
  await sync();
  await h.current.pointer.persistInkStroke(stroke(200));
  await sync();
  assert.equal(s.rows()[0]?.anchor.zoteroPosition?.paths?.length, 2, "the second stroke did not join");

  // Within the 2 s join window: undo the second stroke, then draw again.
  await h.current.undo.undo();
  await sync();
  assert.equal(s.rows()[0]?.anchor.zoteroPosition?.paths?.length, 1, "the undo did not take the stroke off");
  await h.current.pointer.persistInkStroke(stroke(300));
  await sync();

  const starts = s
    .rows()
    .flatMap((r) => r.anchor.zoteroPosition?.paths ?? [])
    .map((p) => Math.round(p[0]!))
    .sort((a, b) => a - b);
  assert.deepEqual(starts, [100, 300], "the undone stroke came back, or the new one was lost");

  await h.unmount();
});
