/**
 * The host's page hooks tell the worker about the right page (21-01, 21-19).
 *
 * The lifecycle loads a page into the worker when the page changes or the
 * sidecar first answers, not when the text flow adds pages after it: a reload
 * there would replace strokes not yet saved. A recognition that finishes after
 * the page changed must not install its page into the worker, which now holds
 * another page.
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import {
  blankInkPage,
  defaultInkNoteMeta,
  makeInkStroke,
  newInkChunkId,
  type InkPage,
  type InkRecogniser,
} from "@weaveforge/core";

import type { InkWorkerMessage } from "../application/capture-protocol";
import type { InkStoredPage } from "../application/ink-chunk-store";
import { useInkPageLifecycle } from "../ui/use-ink-page-lifecycle";
import { useInkRecognition } from "../ui/use-ink-recognition";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: ReturnType<typeof create>[] = [];
afterEach(() => {
  for (const r of mounted.splice(0)) act(() => r.unmount());
});

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });

/** Mount the lifecycle; `render` re-renders it with new page props. */
function mountLifecycle() {
  const sent: InkWorkerMessage[] = [];
  // Null until the sidecar answers, as in the host.
  const pagesRef: { current: InkStoredPage[] | null } = { current: null };
  const stable = {
    send: (message: InkWorkerMessage) => void sent.push(message),
    fetchBlob: async () => new Blob(),
    noteBody: () => "",
    pagesRef,
    metaRef: { current: defaultInkNoteMeta() },
    textPagesRef: { current: [] as string[] },
    setStrokes: () => {},
    setSelection: () => {},
    setBackgroundPath: () => {},
    setFigures: () => {},
    setFigureControls: () => {},
    requestModel: async () => blankInkPage("blank"),
    recognitionReset: () => {},
    recognitionOnModelLoaded: () => {},
  };
  function Probe(props: { pageIndex: number; pageCount: number }) {
    useInkPageLifecycle({ ...stable, ...props });
    return null;
  }
  let root: ReturnType<typeof create> | null = null;
  const render = (pageIndex: number, pageCount: number) =>
    act(() => {
      const element = createElement(Probe, { pageIndex, pageCount });
      if (root) root.update(element);
      else mounted.push((root = create(element)));
    });
  const loads = () => sent.filter((m) => m.type === "load-page").map((m) => (m as { pageIndex: number }).pageIndex);
  return { render, loads, pagesRef };
}

const page = (): InkStoredPage => ({ chunkId: newInkChunkId(), chunk: null, paper: "blank" });

test("the page loads once the sidecar answers, and again when the page changes", async () => {
  const { render, loads, pagesRef } = mountLifecycle();
  render(0, 0);
  assert.deepEqual(loads(), []);
  pagesRef.current = [page(), page()];
  render(0, 2);
  render(1, 2);
  await flush();
  assert.deepEqual(loads(), [0, 1]);
});

test("pages added after the last do not reload the page in use (21-19)", async () => {
  const { render, loads, pagesRef } = mountLifecycle();
  render(0, 0);
  pagesRef.current = [page()];
  render(0, 1);
  pagesRef.current.push(page(), page());
  render(0, 3);
  await flush();
  assert.deepEqual(loads(), [0]);
});

/** A stroke, so the page has a line to recognise. */
function modelWithInk(): InkPage {
  const model = blankInkPage("blank");
  model.strokes = [
    makeInkStroke({ points: [100, 100, 140, 102, 180, 130], pressures: [128, 128, 128], t0: 0 }),
  ];
  return model;
}

/** Mount recognition with an engine that answers when `answer` is called. */
function mountRecognition() {
  const replaced: { page: InkPage; pageIndex: number }[] = [];
  let answer: () => void = () => {};
  const gate = new Promise<void>((resolve) => (answer = resolve));
  const engine: InkRecogniser = {
    id: "test@1",
    offline: true,
    online: true,
    available: async () => true,
    recognise: async () => {
      await gate;
      return [{ text: "hello", conf: 0.9 }];
    },
  };
  const textPagesRef = { current: ["", ""] };
  const stable = {
    recogniser: async () => engine,
    hints: async () => ({ vocabulary: [], lang: "en" }),
    requestModel: async () => modelWithInk(),
    sendReplace: (page: InkPage, pageIndex: number) => void replaced.push({ page, pageIndex }),
    metaRef: { current: defaultInkNoteMeta() },
    textPagesRef,
    scheduleSave: () => {},
  };
  let handle: ReturnType<typeof useInkRecognition> | null = null;
  function Probe(props: { pageIndex: number }) {
    handle = useInkRecognition({ ...stable, ...props });
    return null;
  }
  let root: ReturnType<typeof create> | null = null;
  const render = (pageIndex: number) =>
    act(() => {
      const element = createElement(Probe, { pageIndex });
      if (root) root.update(element);
      else mounted.push((root = create(element)));
    });
  return { render, handle: () => handle!, answer: () => answer(), replaced, textPagesRef };
}

test("a recognition that finishes on its own page is installed", async () => {
  const r = mountRecognition();
  r.render(0);
  let done: Promise<void> | null = null;
  act(() => void (done = r.handle().recognise()));
  r.answer();
  await act(async () => void (await done));
  assert.equal(r.replaced.length, 1);
  assert.equal(r.replaced[0]!.pageIndex, 0);
  assert.ok(r.handle().recognised);
  assert.match(r.textPagesRef.current[0]!, /hello/);
});

test("a recognition that finishes after the page changed leaves the new page alone (21-01)", async () => {
  const r = mountRecognition();
  r.render(0);
  let done: Promise<void> | null = null;
  act(() => void (done = r.handle().recognise()));
  await flush();
  r.render(1);
  r.answer();
  await act(async () => void (await done));
  assert.deepEqual(r.replaced, []);
  assert.equal(r.handle().recognised, null);
  // The text still lands on the page it was read from.
  assert.match(r.textPagesRef.current[0]!, /hello/);
  assert.equal(r.textPagesRef.current[1], "");
});
