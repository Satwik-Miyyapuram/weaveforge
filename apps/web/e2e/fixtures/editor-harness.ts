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
 * uploads so a test can hold one open, finish them out of order, or fail one.
 */
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownEditorExtensions } from "@/components/markdown-editor-extensions";
import { readPasteSettings, writePasteSettings } from "@/lib/paste-cleanup-preference";
import { normalizePasteSettings } from "@weaveforge/core";

const host = document.getElementById("editor")!;
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

const view = new EditorView({
  state: EditorState.create({
    doc: "",
    extensions: markdownEditorExtensions({
      completionsRef: { current: [] },
      citationFormatRef: { current: "wikilink" },
      editableCompartment: new Compartment(),
      themeCompartment: new Compartment(),
      pasteSettingsRef,
      imagePaste: {
        upload: (file) => {
          uploadCount += 1;
          if (mode === "instant") {
            return Promise.resolve(`![${file.name.replace(/\.[a-z]+$/, "")}](vault:u/p/${file.name})`);
          }
          if (mode === "fail") return Promise.reject(new Error("Storage is full."));
          return new Promise<string>((resolve, reject) => {
            uploads.push({ resolve, reject, name: file.name, size: file.size, type: file.type });
          });
        },
        onError: (message) => {
          (window as any).editorHarness.errors.push(message);
        },
        maxBytes: 1024 * 1024,
      },
    }),
  }),
  parent: host,
});

function imageFile(name: string, type = "image/png", bytes = 8): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

(window as any).editorHarness = {
  errors: [] as string[],
  doc: () => view.state.doc.toString(),
  cursor: () => view.state.selection.main.head,
  setDoc: (text: string) =>
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
  setCursor: (pos: number) => view.dispatch({ selection: { anchor: pos } }),
  select: (from: number, to: number) => view.dispatch({ selection: { anchor: from, head: to } }),
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
  dropImages: (names: string[]) => {
    const data = new DataTransfer();
    for (const name of names) data.items.add(imageFile(name));
    const rect = view.contentDOM.getBoundingClientRect();
    view.contentDOM.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: data,
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 5,
        clientY: rect.top + 5,
      }),
    );
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
  decorations: () =>
    view.contentDOM.querySelectorAll(".cm-image-uploading").length,
};
