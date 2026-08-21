/**
 * The editor, on a page of its own.
 *
 * `editor-paste.spec.ts` bundles this file and drives it in a real browser.
 * Doing it this way rather than through the app means the paste behaviour is
 * tested without a database, a session or a network — so it runs on any
 * checkout, in CI, in seconds, and a failure points at the editor rather than
 * at whatever else was broken that morning.
 *
 * Everything the spec needs is hung off `window.editorHarness`: the document,
 * the caret, synthetic clipboard and drag events, and hand control over the
 * uploads and the URL lookups, so a test can hold one open, finish them out of
 * order, or fail one.
 */
import { EditorState, EditorSelection, Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { bindEditorHandle } from "@/components/markdown/markdown-editor-handle";
import type { EditorHandle } from "@/components/editor-handle";
import { markdownEditorExtensions } from "@/components/markdown/markdown-editor-extensions";
import { readPasteSettings, writePasteSettings } from "@/lib/paste-cleanup-preference";
import { normalizePasteSettings } from "@weaveforge/core";
import type { DesktopBridge, DesktopImage } from "@/lib/desktop/desktop-bridge";

const host = document.getElementById("editor")!;

/**
 * A stand-in desktop bridge, so the two lookups can be driven without a server.
 *
 * `outboundFetch()` prefers the bridge when one is present and falls back to
 * `/api/fetch-url` otherwise, so installing one here is what lets a page with no
 * origin and no session exercise the title and image fetches at all. It is also
 * the honest test of the bridge contract: what the Electron preload has to
 * satisfy is exactly this shape.
 */
type RemoteMode = "manual" | "instant" | "fail";

interface RemoteCall {
  kind: "title" | "image";
  url: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

const remoteCalls: RemoteCall[] = [];
let remoteMode: RemoteMode = "manual";
let remoteTitle = "A Page Title";

function remote<T>(kind: "title" | "image", url: string, instant: () => T): Promise<T> {
  if (remoteMode === "instant") return Promise.resolve(instant());
  if (remoteMode === "fail") return Promise.reject(new Error("That address could not be fetched."));
  return new Promise<T>((resolve, reject) => {
    remoteCalls.push({ kind, url, resolve: resolve as (value: unknown) => void, reject });
  });
}

const bridge: DesktopBridge = {
  version: "harness",
  platform: "linux",
  fetchTitle: (url) => remote("title", url, () => ({ title: remoteTitle, url })),
  fetchImage: (url) =>
    remote<DesktopImage>("image", url, () => ({
      bytes: new Uint8Array(8).buffer,
      contentType: "image/png",
      url,
    })),
  // The harness drives the editor, not sign-in. Present so the stub satisfies
  // the contract, and returns a no-op unsubscribe.
  onSignIn: () => () => undefined,
};
(window as unknown as { weaveforge: DesktopBridge }).weaveforge = bridge;

const pasteSettingsRef = { current: readPasteSettings() };

/** Uploads the harness controls, so a test can hold one open or make it fail. */
const uploads: {
  resolve: (markdown: string) => void;
  reject: (reason: Error) => void;
  name: string;
  size: number;
  type: string;
}[] = [];
let mode: "manual" | "instant" | "fail" = "manual";
let uploadCount = 0;

const imagePasteConfig = {
  upload: (file: File) => {
    uploadCount += 1;
    if (mode === "instant") {
      return Promise.resolve(`![${file.name.replace(/\.[a-z]+$/, "")}](vault:u/p/${file.name})`);
    }
    if (mode === "fail") return Promise.reject(new Error("Storage is full."));
    return new Promise<string>((resolve, reject) => {
      uploads.push({ resolve, reject, name: file.name, size: file.size, type: file.type });
    });
  },
  onError: (message: string) => {
    (window as any).editorHarness.errors.push(message);
  },
  maxBytes: 1024 * 1024,
};

const view = new EditorView({
  state: EditorState.create({
    doc: "",
    extensions: [
      // Not part of the editor's own stack — a second caret arrives from
      // `Alt`-clicking, which needs `drawSelection` and this. Turned on here so
      // the multi-caret paste case can be driven at all.
      EditorState.allowMultipleSelections.of(true),
      markdownEditorExtensions({
        completionsRef: { current: [] },
        citationFormatRef: { current: "wikilink" },
        editableCompartment: new Compartment(),
        themeCompartment: new Compartment(),
        pasteSettingsRef,
        imagePaste: imagePasteConfig,
      }),
    ],
  }),
  parent: host,
});

/**
 * The handle a screen's toolbar holds, bound exactly as the real editors bind
 * it — so the attach-image button's path is tested and not just its intent.
 */
const editorHandle: { current: EditorHandle | null } = { current: null };
bindEditorHandle(editorHandle, view, () => imagePasteConfig);

function imageFile(name: string, type = "image/png", bytes = 8): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** A drag carrying whatever data types the caller names. */
function dragEvent(kind: string, data: DataTransfer, at: { x: number; y: number }) {
  return new DragEvent(kind, {
    dataTransfer: data,
    bubbles: true,
    cancelable: true,
    clientX: at.x,
    clientY: at.y,
  });
}

(window as any).editorHarness = {
  errors: [] as string[],
  doc: () => view.state.doc.toString(),
  cursor: () => view.state.selection.main.head,
  setDoc: (text: string) =>
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
  setCursor: (pos: number) => view.dispatch({ selection: { anchor: pos } }),
  select: (from: number, to: number) => view.dispatch({ selection: { anchor: from, head: to } }),
  /** Several carets at once, the last of them the main one. */
  cursors: (positions: number[]) =>
    view.dispatch({
      selection: EditorSelection.create(
        positions.map((at) => EditorSelection.cursor(at)),
        positions.length - 1,
      ),
    }),
  /** What the attach-image button does: hand a chosen file to the editor. */
  attach: (name: string, bytes?: number) =>
    editorHandle.current?.insertFiles([imageFile(name, undefined, bytes)]),
  /** Whether a screen would have a handle to call at all. */
  hasHandle: () => editorHandle.current !== null,
  focus: () => view.focus(),
  uploadCount: () => uploadCount,
  pending: () => uploads.length,
  mode: (next: "manual" | "instant" | "fail") => {
    mode = next;
  },
  /** Clears the in-flight list and the counter, so each case starts clean. */
  resetUploads: () => {
    uploads.length = 0;
    uploadCount = 0;
  },
  settings: (partial: Record<string, unknown>) => {
    const next = normalizePasteSettings({ ...pasteSettingsRef.current, ...partial });
    writePasteSettings(next);
    pasteSettingsRef.current = next;
  },
  /** Finish the nth in-flight upload. */
  finish: (index: number, markdown: string) => {
    uploads[index]?.resolve(markdown);
  },
  failUpload: (index: number, reason: string) => {
    uploads[index]?.reject(new Error(reason));
  },
  paste: (text: string) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    view.contentDOM.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  },
  /** A paste carrying image files, and optionally text alongside them. */
  pasteImages: (names: string[], opts: { text?: string; type?: string; bytes?: number } = {}) => {
    const data = new DataTransfer();
    if (opts.text) data.setData("text/plain", opts.text);
    for (const name of names) data.items.add(imageFile(name, opts.type, opts.bytes));
    view.contentDOM.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  },
  /** Paste text with a selection already in place. */
  pasteOver: (from: number, to: number, text: string) => {
    view.dispatch({ selection: { anchor: from, head: to } });
    const data = new DataTransfer();
    data.setData("text/plain", text);
    view.contentDOM.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  },
  dropImages: (names: string[], opts: { type?: string } = {}) => {
    const data = new DataTransfer();
    for (const name of names) data.items.add(imageFile(name, opts.type));
    const rect = view.contentDOM.getBoundingClientRect();
    view.contentDOM.dispatchEvent(dragEvent("drop", data, { x: rect.left + 5, y: rect.top + 5 }));
  },
  /**
   * A drag that carries no file, only where the picture lives — what dragging
   * an image out of another tab or a mail client actually delivers.
   */
  dropUrl: (types: Record<string, string>) => {
    const data = new DataTransfer();
    for (const [type, value] of Object.entries(types)) data.setData(type, value);
    const rect = view.contentDOM.getBoundingClientRect();
    view.contentDOM.dispatchEvent(dragEvent("drop", data, { x: rect.left + 5, y: rect.top + 5 }));
  },
  /** Whether the editor would accept a drag of these types, rather than let the browser have it. */
  dragAccepted: (types: Record<string, string>) => {
    const data = new DataTransfer();
    for (const [type, value] of Object.entries(types)) data.setData(type, value);
    const rect = view.contentDOM.getBoundingClientRect();
    const event = dragEvent("dragover", data, { x: rect.left + 5, y: rect.top + 5 });
    view.contentDOM.dispatchEvent(event);
    return event.defaultPrevented;
  },
  type: (text: string) => {
    const at = view.state.selection.main;
    view.dispatch({ changes: { from: at.from, to: at.to, insert: text } });
  },
  insertAt: (pos: number, text: string) => view.dispatch({ changes: { from: pos, insert: text } }),
  undo: () => {
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }),
    );
  },
  /**
   * A keydown faithful enough for CodeMirror's keymap.
   *
   * `code` matters: the keymap resolves a shifted binding through the physical
   * key, so an event carrying only `key` matches the unshifted bindings and
   * silently misses `Shift-` ones.
   */
  key: (key: string, mods: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {}) => {
    const codes: Record<string, string> = { ",": "Comma", ".": "Period" };
    const code =
      codes[key] ?? (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : undefined);
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, ...mods }),
    );
  },
  decorations: () => view.contentDOM.querySelectorAll(".cm-pending-insert").length,

  /** How a title or image lookup should behave, and what title to hand back. */
  remote: (next: RemoteMode, title?: string) => {
    remoteMode = next;
    if (title !== undefined) remoteTitle = title;
  },
  /** The lookups still waiting, as `["title https://…", …]`. */
  remoteCalls: () => remoteCalls.map((call) => `${call.kind} ${call.url}`),
  resetRemote: () => {
    remoteCalls.length = 0;
    remoteMode = "manual";
    remoteTitle = "A Page Title";
  },
  finishTitle: (index: number, title: string) => {
    const call = remoteCalls[index];
    call?.resolve({ title, url: call.url });
  },
  finishImage: (index: number) => {
    const call = remoteCalls[index];
    call?.resolve({ bytes: new Uint8Array(8).buffer, contentType: "image/png", url: call.url });
  },
  failRemote: (index: number, reason: string) => {
    remoteCalls[index]?.reject(new Error(reason));
  },
};
