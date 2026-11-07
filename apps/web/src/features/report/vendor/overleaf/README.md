# Overleaf Visual Editor (vendored)

Overleaf's LaTeX parser and Visual Editor, so the workshop editor draws `.tex`
files the way Overleaf does.

- Source: https://github.com/overleaf/overleaf, commit
  `e039ad26c5bf5422eb57b89fc7e57c75055e631d`,
  `services/web/frontend/js/features/source-editor/`.
- License: AGPL-3.0, as Overleaf. Copyright Overleaf.

## What changed

- `lezer-latex/latex.mjs` and `latex.terms.mjs` are generated from
  `latex.grammar` with `@lezer/generator` 1.8.0 (`buildParserFile`,
  `moduleStyle: "es"`).
- Strict TypeScript: `override` on widget methods, `!` on indexed reads, LF
  line endings.
- `shims/`: KaTeX in place of MathJax (`load-mathjax.ts`), a plain error class
  (`o-error.ts`) and text glyphs for Material icons (`material-icon.ts`).
  For graphics: `isEqual` (`lodash.ts`), `debugConsole` (`debugging.ts`),
  pdf.js through our loader (`pdf-js.ts`) and the `PreviewPath` type
  (`preview-path.ts`).
- `extensions/figure-modal.ts` keeps only the `FigureData` class, which
  `parseFigureData` returns.
- `atomic-decorations.ts` uses the plain `GraphicsWidget` and
  `InlineGraphicsWidget`, not the `Editable` ones that open the figure modal.
- `visual.ts` holds English text for the phrase keys, as we have no locale
  files, and Bootstrap's `.visually-hidden`.
- `visual-theme.ts` maps Overleaf's page variables (`--source-font-family`,
  `--font-size`, …) to our theme tokens and uses our serif face.
- `extensions/visual/visual.ts` is ours: the Visual Editor extensions in one
  list, without Overleaf's module hooks.
- The host (`ui/use-file-previews.ts`) fetches the project's images and PDFs
  and gives `filePreview` a resolver over their object URLs.

## Left out

Tables, the figure modal and its edit button, HTML paste, command tooltips, auto-closing
brackets and Overleaf's module hooks. These show as LaTeX source in Visual.

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
