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
- `visual-theme.ts` maps Overleaf's page variables (`--source-font-family`,
  `--font-size`, …) to our theme tokens and uses our serif face.
- `extensions/visual/visual.ts` is ours: the Visual Editor extensions in one
  list, without Overleaf's module hooks.

## Left out

Tables, graphics, figure modal, HTML paste, command tooltips, auto-closing
brackets and Overleaf's module hooks. These show as LaTeX source in Visual.
