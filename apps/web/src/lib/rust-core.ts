/**
 * Loads the Rust core once per page and resolves to its generated functions.
 * The glue is imported lazily so it stays out of first-load JS on every route
 * that renders a caller. A failed load (offline, a missed fetch) is dropped so
 * the next caller tries again. `source` is for tests (the .wasm bytes); the app
 * passes nothing and the browser fetches the module next to the glue.
 * `readyCore()` returns it synchronously once loaded.
 */
import {
  setRustCore,
  type FigureGeometry,
  type InkPage,
  type InkStroke,
} from "@weaveforge/core";
import type { FigurePlacement } from "@weaveforge/wasm";

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
      // Generated float fields read `number | null` (specta); the core contract keeps `number`.
      setRustCore(core as never);
      return core;
    })
    .catch((error: unknown) => {
      loaded = null;
      throw error;
    });
  return loaded;
}

/**
 * Registers a core the host already initialised (desktop main calls initSync),
 * so web code it runs finds the same instance through eadyCore().
 */
export function registerLoadedCore(core: RustCore): void {
  ready = core;
  loaded ??= Promise.resolve(core);
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
type Contract = import("@weaveforge/core").CoreContract;

/**
 * The loaded core under the app's core signatures, limited to names the Rust
 * core exports. The generated binding types are looser in places (mutable
 * arrays, `null` for absent numbers), so callers use the TypeScript core's
 * signatures, or `CoreContract` for functions whose TypeScript was removed.
 * Other names keep their generated binding types.
 */
export type TypedCore = Pick<CoreModule, keyof CoreModule & keyof RustCore> &
  Pick<Contract, keyof Contract & keyof RustCore> &
  Omit<RustCore, keyof CoreModule | keyof Contract>;

export function typedCore(): TypedCore {
  return readyCore() as unknown as TypedCore;
}

/** A stroke as the generated Rust bindings name it. */
export type WasmInkStroke = Parameters<RustCore["strokeClipText"]>[0][number];
/** A page as the generated SVG export names it. */
export type WasmInkSvgPage = Parameters<RustCore["inkPageSvg"]>[0];

// Bindings type f64 as number | null (NaN/Infinity serialise as null); core values are always finite.
export function toWasmInkStrokes(strokes: readonly InkStroke[]): WasmInkStroke[] {
  return strokes as unknown as WasmInkStroke[];
}

// Bindings type f64 as number | null (NaN/Infinity serialise as null); core values are always finite.
export function fromWasmInkStrokes(strokes: readonly WasmInkStroke[]): InkStroke[] {
  return strokes as unknown as InkStroke[];
}

// Bindings type f64 as number | null (NaN/Infinity serialise as null); core values are always finite.
export function toWasmInkPage(page: InkPage): WasmInkSvgPage {
  return page as unknown as WasmInkSvgPage;
}

/** A placed figure from the Rust core; an absent crop comes back as null, the model keeps it undefined. */
export function fromWasmFigure(figure: FigurePlacement): FigureGeometry {
  // Bindings type f64 as number | null (NaN/Infinity serialise as null); core values are always finite.
  const { crop, ...rest } = figure as unknown as Omit<FigureGeometry, "crop"> & { crop?: FigureGeometry["crop"] | null };
  return crop == null ? rest : { ...rest, crop };
}

export function fromWasmFigures(figures: readonly FigurePlacement[]): FigureGeometry[] {
  return figures.map(fromWasmFigure);
}
