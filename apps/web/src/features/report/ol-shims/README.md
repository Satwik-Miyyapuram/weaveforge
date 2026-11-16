# Shims for the Overleaf IDE

Overleaf imports some modules we do not ship: its proprietary history library
(`overleaf-editor-core`), paid or server-only modules (`modules/*`), Uppy,
Sentry and Recurly. These files stand in for them so the IDE, the
`third_party/overleaf` submodule, builds unchanged. The aliases for its tree in
`apps/web/next.config.mjs` point its imports here.

The workshop never runs the code paths behind these stubs (history OT,
payments, error reporting). A stub that would do real work throws, so a wrong
code path fails loudly instead of silently. Uploads are the exception:
`uppy.tsx` is a small working uploader that POSTs through the fetch bridge.

Two shims stand in for more than a package:

- `import-overleaf-module.ts` replaces Overleaf's babel macro
  (`frontend/macros/import-overleaf-module.macro.js`) in the bundle. It lists
  add-on modules; we ship none, so it returns `[]`.
- `codemirror-vim.d.ts` gives tsc a loose type surface for
  `@replit/codemirror-vim`. The bundle uses the real fork, the
`third_party/codemirror-vim` submodule.
