/**
 * The paste door is bound once per mount, though the host hands the hook a
 * fresh deps object every render, and a paste still reaches the latest deps
 * (21-05).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { figureClipText } from "../application/figure-clipboard";
import { useInkPageMedia, type InkPageMediaDeps } from "../ui/use-ink-page-media";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Listener = (event: unknown) => void;

function fakeWindow() {
  const listeners = new Set<Listener>();
  let adds = 0;
  const win = {
    addEventListener: (type: string, fn: Listener) => {
      if (type === "paste") {
        adds++;
        listeners.add(fn);
      }
    },
    removeEventListener: (type: string, fn: Listener) => {
      if (type === "paste") listeners.delete(fn);
    },
  };
  return { win, listeners, adds: () => adds };
}

const focused = {};
const wrap = { contains: (el: unknown) => el === focused } as unknown as HTMLDivElement;

function deps(added: string[], tag: string): InkPageMediaDeps {
  return {
    noteId: "n1",
    pageSize: { width: 100, height: 100 },
    figuresRef: { current: [] },
    pageIndexRef: { current: 0 },
    textPagesRef: { current: [""] },
    wrapRef: { current: wrap },
    onFiguresChange: (next: readonly { path: string }[]) => void added.push(`${tag}:${next.at(-1)?.path}`),
    setUnavailable() {},
  } as unknown as InkPageMediaDeps;
}

function Host(props: { deps: InkPageMediaDeps }) {
  useInkPageMedia(props.deps);
  return null;
}

function pasteEvent() {
  const text = figureClipText({ noteId: "n1", figure: { path: "a.png", x: 1, y: 1, w: 10, h: 10 } });
  return {
    target: null,
    preventDefault() {},
    clipboardData: { getData: () => text, items: [] },
  };
}

test("the paste listener is bound once and uses the latest deps", async () => {
  const fake = fakeWindow();
  const g = globalThis as { window?: unknown; document?: unknown };
  const [oldWin, oldDoc] = [g.window, g.document];
  g.window = fake.win;
  g.document = { activeElement: focused };
  const added: string[] = [];
  try {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(createElement(Host, { deps: deps(added, "first") }));
    });
    for (let i = 0; i < 3; i++) act(() => r.update(createElement(Host, { deps: deps(added, `r${i}`) })));
    assert.equal(fake.adds(), 1);
    assert.equal(fake.listeners.size, 1);
    await act(async () => {
      for (const fn of fake.listeners) fn(pasteEvent());
      await Promise.resolve();
    });
    assert.deepEqual(added, ["r2:a.png"]);
    act(() => r.unmount());
    assert.equal(fake.listeners.size, 0);
  } finally {
    g.window = oldWin;
    g.document = oldDoc;
  }
});

test("a paste outside the pane is left alone", async () => {
  const fake = fakeWindow();
  const g = globalThis as { window?: unknown; document?: unknown };
  const [oldWin, oldDoc] = [g.window, g.document];
  g.window = fake.win;
  g.document = { activeElement: {} };
  const added: string[] = [];
  try {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(createElement(Host, { deps: deps(added, "first") }));
    });
    await act(async () => {
      for (const fn of fake.listeners) fn(pasteEvent());
      await Promise.resolve();
    });
    assert.deepEqual(added, []);
    act(() => r.unmount());
  } finally {
    g.window = oldWin;
    g.document = oldDoc;
  }
});

// A figure from another note is uploaded first, an await the reader can turn
// the page during: it lands on the page it was added to, not the one now live
// (21-23).
async function crossNotePaste(flipTo: number | null) {
  const fake = fakeWindow();
  const g = globalThis as { window?: unknown; document?: unknown };
  const [oldWin, oldDoc] = [g.window, g.document];
  g.window = fake.win;
  g.document = { activeElement: focused };
  let finishUpload!: (path: string) => void;
  const live: string[] = [];
  const selected: number[] = [];
  let saves = 0;
  const pageIndexRef = { current: 0 };
  const textPagesRef = { current: ["", ""] };
  const d = {
    ...deps(live, "live"),
    pageIndexRef,
    textPagesRef,
    scheduleSave: () => void saves++,
    selectFigure: (i: number) => void selected.push(i),
    assets: {
      fetchBlob: async () => new Blob(["x"]),
      upload: () => new Promise<string>((resolve) => (finishUpload = resolve)),
    },
  } as unknown as InkPageMediaDeps;
  const text = figureClipText({ noteId: "other", figure: { path: "a.png", x: 1, y: 1, w: 10, h: 10 } });
  try {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(createElement(Host, { deps: d }));
    });
    await act(async () => {
      for (const fn of fake.listeners)
        fn({ target: null, preventDefault() {}, clipboardData: { getData: () => text, items: [] } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    if (flipTo !== null) pageIndexRef.current = flipTo;
    await act(async () => {
      finishUpload("n1/b.png");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => r.unmount());
    return { live, selected, saves, pages: textPagesRef.current };
  } finally {
    g.window = oldWin;
    g.document = oldDoc;
  }
}

test("a page turned during the upload keeps the figure on its own page", async () => {
  const out = await crossNotePaste(1);
  assert.deepEqual(out.live, [], "the live page is not touched");
  assert.deepEqual(out.selected, [], "a figure on another page is not selected here");
  assert.match(out.pages[0]!, /n1\/b\.png/);
  assert.equal(out.pages[1], "");
  assert.equal(out.saves, 1);
});

test("an upload with no page turn adds to the live page as before", async () => {
  const out = await crossNotePaste(null);
  assert.deepEqual(out.live, ["live:n1/b.png"]);
  assert.deepEqual(out.selected, [0]);
  assert.deepEqual(out.pages, ["", ""]);
});
