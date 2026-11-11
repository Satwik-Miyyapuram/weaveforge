# Reader PDF theme (`reader::pdf_theme`)

Rust: `crates/wf-core/src/reader/pdf_theme.rs`.
Wasm: `crates/wf-wasm/src/reader_pdf_theme.rs`.
TS wrapper: `packages/wf-wasm/src/wrappers-7.ts` (re-exported from `index.ts`).
The app-side TS shim is deleted; `use-dark-pdf.ts` calls `readyCore().shouldUseDarkPdfRendering` directly.

Pure logic: whether PDF pages render in dark mode.

## Exports

| TS | Rust | Notes |
| --- | --- | --- |
| `shouldUseDarkPdfRendering(themeId, mode?)` | `should_use_dark_pdf_rendering(theme_id, mode)` | `mode === "dark"` gives true. Empty or absent theme gives false. Otherwise membership in `DARK_THEME_IDS`. |

`DARK_THEME_IDS` is a Rust copy of `DARK_THEMES` in `apps/web/src/lib/theme/theme.ts`.

## Parity notes

- Drift risk: the Rust list must be updated with `DARK_THEMES`. Nothing enforces this yet.
- The shim calls `readyCore()`, so the core must be loaded before the first render that uses it.
