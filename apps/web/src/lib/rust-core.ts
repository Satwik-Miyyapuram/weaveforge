import { coreInfo, init, type CoreInfo } from "@weaveforge/wasm";

/**
 * The Rust core, loaded once per page. The first caller starts the load; every
 * later caller gets the same promise. `source` is for tests (the .wasm bytes);
 * the app passes nothing and the browser fetches the module next to the glue.
 */
let loaded: Promise<CoreInfo> | null = null;

export function loadCoreInfo(source?: BufferSource): Promise<CoreInfo> {
  loaded ??= init(source === undefined ? undefined : { module_or_path: source }).then(() => coreInfo());
  return loaded;
}
