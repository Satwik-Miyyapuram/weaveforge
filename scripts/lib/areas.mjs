/**
 * One row of the code map: where it is, what it is for, and how it is measured.
 *
 * `unit` is either lines of code or a file tally, because for two of these the
 * honest unit is files — a migration is a step in a sequence whether it is four
 * lines or four hundred, and so is a page of documentation.
 */
export const AREAS = [
  { dir: "crates/wf-core", unit: "lines", what: "The rules, in Rust: pure logic with no I/O, shared by every shell" },
  { dir: "crates/wf-store", unit: "lines", what: "Native I/O in Rust: the workspace folder, blobs, git and models" },
  { dir: "crates/wf-wasm", unit: "lines", what: "wf-core for JavaScript, via wasm-bindgen" },
  { dir: "crates/wf-bindings", unit: "lines", what: "Writes the TypeScript types for every Rust type the UI sees" },
  { dir: "packages/core", unit: "lines", what: "Residual TypeScript: shared contracts and glue that call the Rust core" },
  { dir: "packages/wf-wasm", unit: "lines", what: "TypeScript wrappers and generated types over the WASM module" },
  { dir: "apps/web", unit: "lines", what: "The app itself: screens, features, API routes, backend wiring" },
  { dir: "apps/shell", unit: "lines", what: "The Tauri shell — what only an installed app can do" },
  { dir: "apps/relay", unit: "lines", what: "Relays and pasted-link fetches, in Rust: the wf-relay library and its OCI server" },
  { dir: "apps/pitch", unit: "lines", what: "The public site and this documentation" },
  { dir: "python/weaveforge", unit: "lines", what: "The SDK training scripts import" },
  { dir: "python/tests", unit: "lines", what: "Its tests" },
  { dir: "db/migrations", unit: "files", what: "The schema, as an ordered sequence" },
  { dir: "docs", unit: "files", what: "Documentation, this page included" },
];
