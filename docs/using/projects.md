# Projects

A project is the outermost container in WeaveForge. Every paper, reading list,
log, report section and relation belongs to exactly one project, so a new
project starts with an empty slate of its own.

## Naming a project

A project needs a name. Leading and trailing spaces are trimmed when it is
saved, so `  Thesis  ` is stored as `Thesis`. Spaces inside the name are kept
exactly as typed. A name that is empty or only spaces is refused with
"Project name is required." and nothing is created.

A colour is optional. Each project gets an id and a creation time when it is
made; both are set by the app, not typed by you.

## Where the rule lives

The naming rule is part of the Rust core (`crates/wf-core/src/projects.rs`,
`project_name`), reached from the TypeScript domain through the wasm build
(`projectName`, exported from `project_name_js` in `crates/wf-wasm/src/projects.rs`).
The TypeScript side keeps the error it throws, so the message stays the same in
every screen that creates a project.

Core code calls the Rust core through `rust()`, which needs the wasm module
registered first. The web app does this at startup (`apps/web/src/lib/rust-core.ts`).
Core tests register a stub in their own file, so they run without the wasm
build.
