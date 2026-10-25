import assert from "node:assert/strict";
import test from "node:test";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { DEFAULT_PASTE_SETTINGS } from "@weaveforge/core";
import { pendingInsertSupport } from "../markdown-pending-insert";
import { afterUrlPaste, insertRemoteImage } from "../markdown-remote-paste";

/** Just enough of an EditorView for the pending-insert helpers: state plus dispatch. */
function fakeView(doc: string, caret = doc.length): { view: EditorView; doc: () => string } {
  let state = EditorState.create({ doc, selection: EditorSelection.cursor(caret), extensions: pendingInsertSupport });
  const view = {
    get state() { return state; },
    dispatch(...specs: TransactionSpec[]) { state = state.update(...specs).state; },
  } as unknown as EditorView;
  return { view, doc: () => state.doc.toString() };
}

type Bridge = { fetchTitle: (url: string) => Promise<{ title: string; url: string }>; fetchImage: (url: string) => Promise<{ bytes: Uint8Array; contentType: string; url: string }> };

async function withBridge(bridge: Bridge, run: () => Promise<void>): Promise<void> {
  const g = globalThis as { window?: unknown };
  const original = g.window;
  g.window = { weaveforge: bridge };
  try { await run(); } finally { g.window = original; }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const IMG = "https://ex.com/pics/a%20cat.png";
const okImage: Bridge["fetchImage"] = async (url) => ({ bytes: new Uint8Array([1]), contentType: "image/png", url });
const noTitle: Bridge["fetchTitle"] = async () => { throw new Error("no"); };

test("a pasted image URL becomes a placeholder, then the uploaded picture (12-13)", async () => {
  const { view, doc } = fakeView(`see ${IMG}`);
  const names: string[] = [];
  await withBridge({ fetchTitle: noTitle, fetchImage: okImage }, async () => {
    afterUrlPaste(view, IMG, 4, 4 + IMG.length, {
      settings: () => DEFAULT_PASTE_SETTINGS,
      images: { upload: async (file) => { names.push(file.name); return "![cat](vault:a.png)"; } },
    });
    assert.match(doc(), /^see !\[Downloading .*cat.*…\]\(\)$/);
    await settle();
  });
  assert.deepEqual(names, ["a cat.png"]);
  assert.equal(doc(), "see ![cat](vault:a.png)");
});

test("a failed download puts the URL back and reports why (12-13)", async () => {
  const { view, doc } = fakeView(IMG);
  const errors: string[] = [];
  await withBridge({ fetchTitle: noTitle, fetchImage: async () => { throw new Error("blocked"); } }, async () => {
    afterUrlPaste(view, IMG, 0, IMG.length, {
      settings: () => DEFAULT_PASTE_SETTINGS,
      images: { upload: async () => "never", onError: (m) => errors.push(m) },
    });
    await settle();
  });
  assert.equal(doc(), IMG);
  assert.deepEqual(errors, ["blocked"]);
});

test("a dropped image URL is inserted at the caret the same way (12-13)", async () => {
  const ok = fakeView("ab", 1);
  const bad = fakeView("ab", 1);
  const errors: string[] = [];
  await withBridge({ fetchTitle: noTitle, fetchImage: okImage }, async () => {
    insertRemoteImage(ok.view, "https://ex.com/", { upload: async (file) => `![](${file.name})` });
    assert.match(ok.doc(), /^a!\[Downloading .*image.*…\]\(\)b$/);
    await settle();
  });
  assert.equal(ok.doc(), "a![](image)b");
  await withBridge({ fetchTitle: noTitle, fetchImage: async () => { throw new Error(""); } }, async () => {
    insertRemoteImage(bad.view, IMG, { upload: async () => "never", onError: (m) => errors.push(m) });
    await settle();
  });
  assert.equal(bad.doc(), `a${IMG}b`);
  assert.deepEqual(errors, ["That address could not be fetched."]);
});

test("a fetched title becomes an escaped one-line link label (12-14)", async () => {
  const url = "https://ex.com/post";
  const { view, doc } = fakeView(url);
  await withBridge({ fetchTitle: async () => ({ title: " A [b]\\c\r\nd ", url }), fetchImage: okImage }, async () => {
    afterUrlPaste(view, url, 0, url.length, { settings: () => DEFAULT_PASTE_SETTINGS });
    await settle();
  });
  assert.equal(doc(), String.raw`[A \[b\]\\c d](https://ex.com/post)`);
});

test("text that is not a bare URL is left alone", async () => {
  const { view, doc } = fakeView("https://a.b c");
  await withBridge({ fetchTitle: async () => ({ title: "T", url: "" }), fetchImage: okImage }, async () => {
    afterUrlPaste(view, "https://a.b c", 0, 13, { settings: () => DEFAULT_PASTE_SETTINGS });
    await settle();
  });
  assert.equal(doc(), "https://a.b c");
});
