/**
 * The Rust core, as packages/core sees it. This package cannot import the wasm
 * package, so the app registers the loaded module here (apps/web
 * `lib/rust-core.ts`), and core glue calls Rust through `rust()`.
 *
 * `RustCoreFns` lists only the functions core calls. Add a line when a core
 * file starts calling a new one: the app's `setRustCore(module)` call fails to
 * typecheck if the wasm module does not export it with that signature.
 */
export interface RustCoreFns {
  normalizeDoi(doi?: string): string | undefined;
  projectName(name: string): string | undefined;
}

let core: RustCoreFns | null = null;

export function setRustCore(module: RustCoreFns): void {
  core = module;
}

export function rust(): RustCoreFns {
  if (!core) throw new Error("Rust core not registered yet: the app calls setRustCore() after loading it");
  return core;
}
