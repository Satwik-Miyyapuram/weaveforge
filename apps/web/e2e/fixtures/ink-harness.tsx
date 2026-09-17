/**
 * The ink editor, on a page of its own.
 *
 * `scripts/ink-image-cdp.mjs` bundles this file, serves it over `http://` and
 * drives it in a real browser over CDP. Doing it this way rather than through
 * the app means the image affordances are tested with real pointer events, a
 * real `createImageBitmap`, a real worker and a real clipboard — but without a
 * database, a session or a network, so it runs on any checkout.
 *
 * The page it is served on is https rather than `file://` for one reason: the
 * host builds its worker from `new URL("../worker/ink-worker.ts", import.meta.url)`
 * (§6.2), which needs a real module URL to resolve against. The driver bundles
 * the worker to exactly that path.
 *
 * Everything the driver needs is hung off `window.inkHarness`: the note's body
 * as it is saved, the chunks as they are written, and the vault the page images
 * go into — so a test can assert the text layer, the chunk's own background
 * index, and the bytes, rather than only what the canvas looks like.
 */
import { createRoot } from "react-dom/client";

import {
  decodeInkChunk,
  defaultInkNoteMeta,
  inkPageBackground,
  inkPageFigures,
  joinInkTextLayer,
  pageFromChunk,
  readInkNoteBody,
  splitInkTextLayer,
  writeInkNoteBody,
} from "@weaveforge/core";

import { availableInkChunkCodec } from "@/features/ink/application/ink-chunk-codec";
import { MemoryInkChunkStore } from "@/features/ink/application/ink-chunk-store";
import { InkHost } from "@/features/ink/ui/ink-host";

import "@/app/styles/index.css";

const NOTE_ID = "note-1";

const chunks = new MemoryInkChunkStore();

/**
 * Everything that went wrong, in the page's own words.
 *
 * A host that never saves is almost always a worker that never came up, and
 * that failure is invisible from the outside — the pane just sits there. The
 * worker is wrapped before the host can build one, and the rejections the host
 * throws away with `void` are caught here, so "it did not work" arrives with a
 * reason attached.
 */
const problems: string[] = [];
const workerStats = { created: 0, messages: 0, errors: 0, url: null as string | null };

class ReportingWorker extends Worker {
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    workerStats.created += 1;
    workerStats.url = String(url);
    this.addEventListener("message", () => {
      workerStats.messages += 1;
    });
    this.addEventListener("error", (event) => {
      workerStats.errors += 1;
      problems.push(`worker error: ${event.message || "unknown"}`);
    });
    this.addEventListener("messageerror", () => {
      workerStats.errors += 1;
      problems.push("worker messageerror");
    });
  }
}
window.Worker = ReportingWorker;
window.addEventListener("unhandledrejection", (event) => {
  problems.push(`unhandled rejection: ${String(event.reason)}`);
});

/** The vault, as a map of path → bytes. Uploads land here and read back. */
const vault = new Map<string, Blob>();
let uploadCount = 0;

const deps = {
  chunks,
  assets: {
    // Scheme-less, like the real store (`bucket-asset-store.ts`): the `vault:`
    // an ink page's text layer carries is added by the note format, not here.
    async upload(_ownerId: string, blob: Blob, ext: string) {
      uploadCount += 1;
      const path = `u/note/${String(uploadCount).padStart(3, "0")}.${ext}`;
      vault.set(path, blob);
      return path;
    },
    async fetchBlob(path: string) {
      const blob = vault.get(path);
      if (!blob) throw new Error(`no such asset: ${path}`);
      return blob;
    },
  },
  // Recognition is not what this page is for; `null` is what the host shows the
  // text column for, and the ink path never asks again.
  recogniser: async () => null,
  hints: async () => ({ vocabulary: [], lang: "en" }),
};

/** Every body the host has saved, oldest first. */
const saves: string[] = [];
let body = writeInkNoteBody(defaultInkNoteMeta(), joinInkTextLayer([""]));

const root = createRoot(document.getElementById("ink")!);
/** Mount the host afresh over the same store, as a mode switch does. */
function mount() {
  root.render(
    <InkHost
      key={Date.now()}
      noteId={NOTE_ID}
      body={body}
      deps={deps}
      onSave={async (next) => {
        body = next;
        saves.push(next);
      }}
    />,
  );
}
mount();

/** A byte array as base64, for crossing the CDP boundary as JSON. */
function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return btoa(out);
}

/** The chunk a page's id names, or null. */
async function chunkOf(chunkId: string): Promise<Uint8Array | null> {
  return chunks.read(NOTE_ID, chunkId);
}

interface InkHarness {
  readonly saves: string[];
  /** The body as it now stands. */
  body(): string;
  /** The saved body's text layer, page by page. */
  pages(): string[];
  /** The `vault:` path page `index`'s background is, or null. */
  backgroundPath(index?: number): string | null;
  /** The figures page `index` places, geometry and all. */
  figures(index?: number): {
    path: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }[];
  /** What is in the vault: path, byte length and MIME type. */
  vault(): { path: string; size: number; type: string }[];
  /** One vault entry's bytes, for a test that wants to decode as the app does. */
  fetchBlobFor(path: string): Promise<Blob>;
  /** The chunk ids the store holds. */
  chunkIds(): Promise<string[]>;
  /** One chunk's bytes as base64, addressed by its page index. */
  chunkBase64(index: number): Promise<string | null>;
  /** The header byte a page's chunk carries for its background (§4.8). */
  chunkBackground(index: number): Promise<number | null>;
  /** How many strokes page `index`'s chunk holds; `null` for no chunk yet. */
  strokeCount(index: number): Promise<number | null>;
  /** The lowest point of any stroke on page `index`, in page units. */
  maxY(index: number): Promise<number | null>;
  /** Unmount the host and mount a new one, as switching Ink → Read → Ink does. */
  remount(): void;
  uploadCount(): number;
  /** Whether the host's worker came up, and how talkative it has been. */
  worker(): typeof workerStats;
  /** Anything the page went wrong about, in the order it did. */
  problems(): string[];
  /**
   * Wait until the host has stopped saving.
   *
   * Quiet rather than "one more save": the writes here are debounced and a
   * change can legitimately produce two (the chunk, then the body), so waiting
   * for an increment races the first of them.
   */
  settled(quietMs?: number, timeoutMs?: number): Promise<void>;
}

declare global {
  interface Window {
    inkHarness: InkHarness;
  }
}

window.inkHarness = {
  saves,
  body: () => body,
  pages: () => splitInkTextLayer(readInkNoteBody(body).text),
  backgroundPath: (index = 0) =>
    inkPageBackground(splitInkTextLayer(readInkNoteBody(body).text)[index] ?? ""),
  figures: (index = 0) =>
    inkPageFigures(splitInkTextLayer(readInkNoteBody(body).text)[index] ?? "").map(
      ({ path, x, y, w, h }) => ({ path, x, y, w, h }),
    ),
  vault: () =>
    [...vault.entries()].map(([path, blob]) => ({
      path,
      size: blob.size,
      type: blob.type,
    })),
  fetchBlobFor: (path: string) => deps.assets.fetchBlob(path),
  chunkIds: async () => {
    const order = readInkNoteBody(body).meta.pageOrder;
    const present = await chunks.list(NOTE_ID);
    return [...new Set([...order, ...present])];
  },
  chunkBase64: async (index) => {
    const ids = await window.inkHarness.chunkIds();
    const id = ids[index];
    if (!id) return null;
    const bytes = await chunkOf(id);
    return bytes ? toBase64(bytes) : null;
  },
  chunkBackground: async (index) => {
    const ids = await window.inkHarness.chunkIds();
    const id = ids[index];
    if (!id) return null;
    const bytes = await chunkOf(id);
    if (!bytes) return null;
    // Read through the real decoder rather than a byte offset: the background
    // lives in the body, which is deflated on a page big enough to be worth
    // compressing (§4.3), so the offset in the file is not fixed.
    const page = pageFromChunk(
      await decodeInkChunk(bytes, availableInkChunkCodec()),
    );
    return page.background;
  },
  strokeCount: async (index) => {
    const ids = await window.inkHarness.chunkIds();
    const id = ids[index];
    if (!id) return null;
    const bytes = await chunkOf(id);
    if (!bytes) return null;
    return pageFromChunk(
      await decodeInkChunk(bytes, availableInkChunkCodec()),
    ).strokes.length;
  },
  maxY: async (index) => {
    const ids = await window.inkHarness.chunkIds();
    const id = ids[index];
    if (!id) return null;
    const bytes = await chunkOf(id);
    if (!bytes) return null;
    const page = pageFromChunk(await decodeInkChunk(bytes, availableInkChunkCodec()));
    let max = 0;
    for (const stroke of page.strokes) {
      for (let i = 1; i < stroke.points.length; i += 2) max = Math.max(max, stroke.points[i]!);
    }
    return max;
  },
  remount: () => {
    root.render(null);
    mount();
  },
  uploadCount: () => uploadCount,
  worker: () => workerStats,
  problems: () => problems,
  settled: async (quietMs = 600, timeoutMs = 20_000) => {
    const started = Date.now();
    let seen = saves.length;
    let lastChange = Date.now();
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (saves.length !== seen) {
        seen = saves.length;
        lastChange = Date.now();
      }
      if (Date.now() - lastChange >= quietMs) return;
      if (Date.now() - started > timeoutMs) {
        throw new Error(
          `the host never settled (${saves.length} saves; worker: ` +
            `${JSON.stringify(workerStats)}; ` +
            `${problems.join("; ") || "nothing reported"})`,
        );
      }
    }
  },
};

