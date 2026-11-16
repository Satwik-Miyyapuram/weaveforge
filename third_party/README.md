# Third-party source

Upstream projects the app builds from, as git submodules, unmodified.

```sh
git submodule update --init --filter=blob:none
```

`overleaf` is a whole monorepo; the app reads only part of it. To check out
just that part:

```sh
git submodule update --init --filter=blob:none --no-checkout third_party/overleaf
git -C third_party/overleaf sparse-checkout set .yarn/patches libraries \
  services/web/app services/web/frontend services/web/locales services/web/types
git -C third_party/overleaf checkout
```

## overleaf: the Overleaf IDE

Overleaf's whole IDE, mounted in the workshop editor so a project opens and
compiles as it does on Overleaf; only the theme is ours.

- Source: https://github.com/overleaf/overleaf, commit
  `e039ad26c5bf5422eb57b89fc7e57c75055e631d`; the IDE is `services/web/`.
- License: AGPL-3.0, as Overleaf. Copyright Overleaf.

The app reaches it only through `apps/web/src/features/report/ol-host`, whose
`tsconfig.json` checks the IDE with Overleaf's strictness.
`apps/web/next.config.mjs` resolves the IDE's `@/` and `@ol-types/` roots and
the rest of what it imports, for its tree only:

- `@codemirror/autocomplete` 6.18.4 and `@codemirror/search` 6.5.8 (MIT), with
  Overleaf's patches from `.yarn/patches`, and the LaTeX and BibTeX parsers
  generated from its grammars: built into `apps/web/.overleaf-build/` by
  `apps/web/scripts/build-overleaf-assets.mjs`.
- `pdfjs-dist`: Overleaf pins 5.1.91; the app keeps 4. The npm alias
  `pdfjs-dist-overleaf` holds 5.1.91.
- `apps/web/src/features/report/ol-shims/`: stand-ins for modules we do not
  ship (see its README).

### Files the app overrides

Copies under `apps/web/src/features/report/ol-host/overrides/`, at the same
path as in `services/web/`, which next.config.mjs swaps in for the submodule's:

- `visual-widgets/graphics.ts` (`createImage`) and `file-view/components/file-view-image.tsx`
  load project images through `ol-host/image-url.ts` (fetch, then a blob URL),
  so the fetch bridge serves them; a plain `<img src="/project/...">` skips it.
- `ide-react/components/toolbar/toolbar.tsx` portals the bar into the host's
  toolbar row.

## codemirror-vim: Overleaf's vim mode

Overleaf's fork of `@replit/codemirror-vim`, https://github.com/overleaf/codemirror-vim
at `1bef138382d948018f3f9b8a4d7a70ab61774e4b` (MIT, see its `LICENSE`). The
IDE's `@replit/codemirror-vim` resolves to its `src/`.
