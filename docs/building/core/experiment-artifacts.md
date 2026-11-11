# Experiment artifacts core (`experiment_artifacts`)

The pure rules for experiment artifact entries: the storage key segment,
the view URL, and whether an entry is an absolute link. It reads no storage
and no clock.

## What lives in Rust

Source: `crates/wf-core/src/experiment_artifacts.rs`

- `safe_name`: a filename that is safe as one storage key segment.
- `viewable_artifact_url`: the URL to render for a stored entry inside the
  Tauri shell, or `None` when a desktop-local path is refused.
- `is_absolute_url`: true for an `app://artifacts/` entry or an `http`/`https`
  URL. A storage path is not a link.
- `is_absolute_entry`: true for an `app://artifacts/` entry, a `data:` URI, or
  text starting with `http://` or `https://` in any case. Nothing is parsed, so
  a bare prefix counts.
- `artifact_kind`: `ArtifactKind::Image`, `Pdf` or `Link` for a stored entry.
  A `data:` URI is classified by its MIME type; any other entry by the
  lowercased extension of its path (query and fragment ignored).

## How the app calls it

The wasm exports live in `crates/wf-wasm/src/experiment_artifacts.rs`
(`safeName`, `viewableArtifactUrl`, `isAbsoluteUrl`, `isAbsoluteEntry`, `artifactKind`). The TypeScript
wrapper is `packages/wf-wasm/src/wrappers-2.ts`.

`apps/web/src/features/experiments/infrastructure/experiment-artifact-store.ts`
calls `readyCore()` for `isAbsoluteUrl`, `viewableArtifactUrl` and `safeName`.
`apps/web/src/features/experiments/ui/artifact-items.ts` calls `readyCore()` for
`artifactKind`, `isAbsoluteEntry` and `figureLabel`.
The I/O (signing and upload through `IBlobStore`) stays in TypeScript.

## Parity notes

- `is_absolute_url` uses the `url` crate. Its scheme check (`http` or `https`)
  matches the former `new URL(value).protocol` check in TypeScript.
- `artifact_kind` keeps the former TypeScript split: `new URL(entry).pathname`
  when the entry parses, otherwise the text before `?`. The `url` crate path
  matches WHATWG `pathname` for http(s) and `app://` entries.
- `is_absolute_entry` replaces the former `isAbsolute` in `artifact-items.ts`. It
  is not `is_absolute_url`: it accepts `data:` entries (Rust `is_absolute_url`
  rejects them) and a bare `https://` or `http://` prefix with no parse. The
  `http`/`https` check ignores ASCII case, as the former `/^https?:\/\//i` regex did.
