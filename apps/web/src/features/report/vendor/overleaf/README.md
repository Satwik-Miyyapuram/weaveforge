# Overleaf IDE (vendored)

Overleaf's whole IDE, mounted in the workshop editor so a project opens and
compiles as it does on Overleaf; only the theme is ours.

- Source: https://github.com/overleaf/overleaf, commit
  `e039ad26c5bf5422eb57b89fc7e57c75055e631d`, `services/web/`.
- License: AGPL-3.0, as Overleaf. Copyright Overleaf.

## Whole IDE

`app/`, `frontend/`, `libraries/` and `types/` hold Overleaf's IDE from the same
commit, under the same paths as in `services/web/` (and `libraries/`).
`tsconfig.json` here checks them with Overleaf's strictness; the web app sees
them only through the host.

- `codemirror/autocomplete` and `codemirror/search`: Overleaf's patched builds
  of `@codemirror/autocomplete` 6.18.4 and `@codemirror/search` 6.5.8 (MIT).
- `codemirror/vim`: Overleaf's fork of `@replit/codemirror-vim`,
  https://github.com/overleaf/codemirror-vim at
  `1bef138382d948018f3f9b8a4d7a70ab61774e4b` (`src/`, MIT, see its `LICENSE`).
- `pdfjs-dist`: Overleaf pins 5.1.91; the app keeps 4. The npm alias
  `pdfjs-dist-overleaf` holds 5.1.91, and `next.config.mjs` and `paths` in
  `tsconfig.json` point this tree's `pdfjs-dist` at it.
- `ol-shims/`: stand-ins for modules we do not ship (see its README).
