/**
 * Loads the Rust core once per page and resolves to its generated functions.
 * The glue is imported lazily so it stays out of first-load JS on every route
 * that renders a caller. A failed load (offline, a missed fetch) is dropped so
 * the next caller tries again. `source` is for tests (the .wasm bytes); the app
 * passes nothing and the browser fetches the module next to the glue.
 * `readyCore()` returns it synchronously once loaded.
 */
import { setRustCore } from "@weaveforge/core";

export type RustCore = typeof import("@weaveforge/wasm");

/** UI typing for the Rust workspace types (crates/wf-core/src/sync/text_diff.rs). */
export type HunkPick = "ours" | "theirs" | "both";
export interface DiffLine {
  op: "same" | "ours" | "theirs";
  text: string;
}
/** Conflict marker lines, as the Rust core writes them. */
export const MARKER_OURS = "<<<<<<< this app";
export const MARKER_THEIRS = ">>>>>>> the folder";

let loaded: Promise<RustCore> | null = null;
let ready: RustCore | null = null;

export function loadCore(source?: BufferSource): Promise<RustCore> {
  loaded ??= import("@weaveforge/wasm")
    .then(async (core) => {
      await core.init(
        source === undefined ? undefined : { module_or_path: source },
      );
      ready = core;
      setRustCore(core);
      return core;
    })
    .catch((error: unknown) => {
      loaded = null;
      throw error;
    });
  return loaded;
}

/**
 * The loaded core, for synchronous callers such as React render. The app
 * shell awaits `loadCore()` before it renders anything that calls this, and
 * the web tests preload it, so a throw here means a caller ran too early.
 */
export function readyCore(): RustCore {
  if (!ready) throw new Error("Rust core not loaded yet: await loadCore() first");
  return ready;
}

type CoreModule = typeof import("@weaveforge/core");

/**
 * The loaded core under the TypeScript core's signatures, limited to names the
 * Rust core exports. The generated binding types are looser in places (mutable
 * arrays, `null` for absent numbers); parity tests hold both cores to the same
 * results, so callers that keep the app's core types use this.
 */
export function typedCore(): Pick<CoreModule, keyof CoreModule & keyof RustCore> {
  return readyCore() as unknown as Pick<CoreModule, keyof CoreModule & keyof RustCore>;
}
