# Shims for the vendored Overleaf IDE

Overleaf imports some modules we do not ship: its proprietary history library
(`overleaf-editor-core`), paid or server-only modules (`modules/*`), Uppy,
Sentry and Recurly. These files stand in for them so the vendored code builds
unchanged. Only import specifiers in the vendored files point here.

The workshop never runs the code paths behind these stubs (history OT,
payments, error reporting). A stub that would do real work throws, so a wrong
code path fails loudly instead of silently. Uploads are the exception:
`uppy.tsx` is a small working uploader that POSTs through the fetch bridge.

Two shims are wired by config, not by import specifiers:

- `import-overleaf-module.ts` replaces Overleaf's babel macro
  (`frontend/macros/import-overleaf-module.macro.js`) in the bundle. It lists
  add-on modules; we ship none, so it returns `[]`.
- `codemirror-vim.d.ts` gives tsc a loose type surface for
  `@replit/codemirror-vim`. The bundle uses the real fork in `../codemirror/vim`.
