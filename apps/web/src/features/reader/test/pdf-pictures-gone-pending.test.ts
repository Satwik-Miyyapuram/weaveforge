/**
 * A picture that goes away takes its held write with it (P2-197).
 *
 * The editor holds a drag for 250 ms before writing it. When the picture went
 * away (undo, a delete from the list, a sync) the editor closed but the timer
 * stayed, so a picture that came back inside that window had the old drag
 * written over it.
 */

import { before, test } from "node:test";
import assert from "node:assert/strict";

import { loadTestCore } from "@/lib/test/load-test-core";
import { renderHook } from "@/lib/test/react-harness";
import { usePdfPictures, type PdfPicturesDeps } from "../ui/pdf-reader/use-pdf-pictures";

before(loadTestCore);

const row = {
  querySelector: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 612, bottom: 792, width: 612, height: 792 }),
  setPointerCapture: () => {},
  releasePointerCapture: () => {},
  hasPointerCapture: () => false,
};

function ev(x: number, y: number) {
  return {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    altKey: false,
    shiftKey: false,
    clientX: x,
    clientY: y,
    currentTarget: row,
    target: row,
    preventDefault: () => {},
  } as unknown as React.PointerEvent<HTMLElement>;
}

const picture = {
  id: "pic-1",
  type: "image",
  origin: "local",
  page: 1,
  color: "#000000",
  text: "",
  tags: [],
  sortIndex: "00000|000000|00000",
  zoteroKey: null,
  createdAt: "2026-11-21T00:00:00Z",
  updatedAt: "2026-11-21T00:00:00Z",
  comment: "![picture](pictures/a.png)",
  anchor: { zoteroPosition: { pageIndex: 0, rects: [[100, 592, 300, 692]] } },
};

function deps(annotations: unknown[], saved: unknown[]): PdfPicturesDeps {
  return {
    canCreate: true,
    createTool: "select",
    scale: 1,
    rotation: 0,
    pageSize: { width: 612, height: 792 },
    pageGeometries: { current: new Map() },
    annotations,
    annotationsByPage: new Map([[1, annotations]]),
    saveAnchor: (async (...args: unknown[]) => {
      saved.push(args);
    }) as unknown as PdfPicturesDeps["saveAnchor"],
    updateLocal: (async () => {}) as unknown as PdfPicturesDeps["updateLocal"],
    removeLocal: (async () => true) as unknown as PdfPicturesDeps["removeLocal"],
  } as unknown as PdfPicturesDeps;
}

test("a picture that goes and comes back does not get the old drag written", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const saved: unknown[] = [];
  const h = await renderHook(usePdfPictures, deps([picture], saved));

  assert.equal(h.current.pointerDown(1, ev(200, 150)), true, "the press did not pick the picture up");
  await h.flush();
  h.current.pointerMove(ev(240, 150));
  h.current.pointerUp(ev(240, 150));
  await h.flush();
  assert.ok(h.current.edit, "the editor is open");

  // The picture goes (an undo), and comes back (a redo) inside the hold.
  await h.rerender(deps([], saved));
  assert.equal(h.current.edit, null, "the editor closed with its picture");
  await h.rerender(deps([picture], saved));

  t.mock.timers.tick(300);
  await h.flush();
  assert.equal(saved.length, 0, "the old drag was written over the picture that came back");
  await h.unmount();
});
