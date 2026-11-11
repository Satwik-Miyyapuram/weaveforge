# Pitch share card core module

The `pitch_share_card` module holds the data behind the pitch's link preview: the
shared title and description, the origin the app answers on, and the Open Graph and
Twitter card fields with their image path. It does no I/O and reads no environment.
The caller passes the configured origin and base path.

## What lives in Rust

- `pitch_share_constants()`: the pitch title, description and default app origin.
- `app_origin_from(configured)`: the origin an app deployment answers on. An unset,
  unparseable or non-http(s) value gives the default origin. A valid value is reduced
  to its scheme, host and port (the `url` crate's origin serialisation).
- `pitch_share_card(base_path, path)`: the card data. The Open Graph type is
  `website`, the site name `WeaveForge`, the locale `en`, the card type
  `summary_large_image`. The image is `${basePath}/og.png` at 1200x630 with the alt
  text `${PITCH_TITLE}.`.

Source: `crates/wf-core/src/pitch_share_card.rs`. The tests in the same file carry the
cases from the TypeScript tests.

## How the app calls it

The wasm exports live in `crates/wf-wasm/src/pitch_share_card.rs`:
`appOriginFrom`, `pitchShareConstants` and `pitchShareCard`. The TypeScript wrappers
in `packages/wf-wasm/src/wrappers-6.ts` import the raw names from
`../pkg/wf_wasm.js` and export typed versions with the `PitchShareCard`,
`PitchShareImage` and `PitchShareConstants` types.

`apps/web/src/app/pitch/share-card.ts` still builds the Next.js `Metadata` object
(`metadataBase` from `new URL(origin)`, `openGraph`, `twitter`) in TypeScript. Next
needs that object shape, and the URL class is needed to build `metadataBase`.

## What stays in TypeScript, and why

- **The Next.js `Metadata` object and `metadataBase`.** Next.js reads these shapes
  directly. Rust returns the data, and TypeScript only maps it into the object.
- **The app's environment read.** The app reads its configured origin and hands it in.
  Rust never reads the environment.

## Known gap

`apps/pitch` does not load the wasm core, and its `layout.tsx` builds metadata at
build time. Until that app calls `loadCore()`, the metadata code cannot call
`readyCore()` there, so `apps/pitch` keeps the TypeScript share card for now.
