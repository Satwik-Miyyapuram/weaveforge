/**
 * Strokes drawn in one breath join one mark (`persistInkStroke`). The join
 * must build on the anchor last saved, not on the annotation list, which only
 * catches up on the next render: a stroke landing before that render would
 * otherwise write over the stroke before it.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { ReaderAnnotation } from "@weaveforge/core";
import type { CombinedPdfAnchor } from "@weaveforge/wasm";

import { loadTestCore } from "@/lib/test/load-test-core";
import { renderHook } from "@/lib/test/react-harness";
import { usePagePointer, type PagePointerDeps } from "../ui/pdf-reader/use-page-pointer";

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
  } as ReaderAnnotation;
}

const stroke = (x: number) => ({ pageNumber: 1, pageHeight: 800, path: [x, 100, x + 10, 120, x + 20, 140], width: 2 });

test("two strokes joining one mark 10 ms apart both survive a reload", async () => {
  const saved: CombinedPdfAnchor[] = [];
  let created: ReaderAnnotation | null = null;
  const deps = {
    canCreate: true,
    createTool: "ink",
    createColor: "#ff0000",
    inkEditable: true,
    selectedAnnId: null,
    pageSize: { width: 600, height: 800 },
    scale: 1,
    rotation: 0,
    pageGeometries: { current: new Map() },
    annotations: [] as ReaderAnnotation[],
    annotationsByPage: new Map(),
    persistDraft: (async (draft: { anchor: CombinedPdfAnchor }) => {
      created = row("a1", draft.anchor);
      return created;
    }) as unknown as PagePointerDeps["persistDraft"],
    removeLocal: (async () => {}) as unknown as PagePointerDeps["removeLocal"],
    saveAnchor: (async (_ann: ReaderAnnotation, anchor: CombinedPdfAnchor) => {
      saved.push(anchor);
    }) as unknown as PagePointerDeps["saveAnchor"],
  } as unknown as PagePointerDeps;
  const h = await renderHook(usePagePointer, deps);

  await h.current.persistInkStroke(stroke(100));
  // The list catches up once with the new row, then stays a render behind.
  await h.rerender({ ...deps, annotations: [created!] });
  await h.current.persistInkStroke(stroke(200));
  await new Promise((r) => setTimeout(r, 10));
  await h.current.persistInkStroke(stroke(300));
  await h.flush();

  const last = saved.at(-1);
  const paths = last?.zoteroPosition?.paths ?? [];
  assert.equal(paths.length, 3, "a stroke wrote over the one before it");
  assert.deepEqual(
    paths.map((p) => Math.round(p[0]!)),
    [100, 200, 300],
  );

  await h.unmount();
});
