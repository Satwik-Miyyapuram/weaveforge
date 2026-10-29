import { init } from "@weaveforge/wasm";

/**
 * Loads the Rust core once per page. Every caller awaits the same promise,
 * then calls the generated functions from @weaveforge/wasm directly. A failed
 * load (offline, a missed fetch) is dropped so the next caller tries again.
 * `source` is for tests (the .wasm bytes); the app passes nothing and the
 * browser fetches the module next to the glue.
 */
let loaded: Promise<void> | null = null;

export function loadCore(source?: BufferSource): Promise<void> {
  loaded ??= init(source === undefined ? undefined : { module_or_path: source }).then(
    () => undefined,
    (error: unknown) => {
      loaded = null;
      throw error;
    },
  );
  return loaded;
}
