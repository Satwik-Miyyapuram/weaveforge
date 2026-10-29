/**
 * Loads the Rust core once per page and resolves to its generated functions.
 * The glue is imported lazily so it stays out of first-load JS on every route
 * that renders a caller. A failed load (offline, a missed fetch) is dropped so
 * the next caller tries again. `source` is for tests (the .wasm bytes); the app
 * passes nothing and the browser fetches the module next to the glue.
 */
export type RustCore = typeof import("@weaveforge/wasm");

let loaded: Promise<RustCore> | null = null;

export function loadCore(source?: BufferSource): Promise<RustCore> {
  loaded ??= import("@weaveforge/wasm")
    .then(async (core) => {
      await core.init(
        source === undefined ? undefined : { module_or_path: source },
      );
      return core;
    })
    .catch((error: unknown) => {
      loaded = null;
      throw error;
    });
  return loaded;
}
