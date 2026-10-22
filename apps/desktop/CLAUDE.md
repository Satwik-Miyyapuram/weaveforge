# apps/desktop

Electron shell. Test: `npm run test:desktop`; one file:
`node --import tsx --test test/<name>.test.ts`. Typecheck:
`npm run typecheck --workspace @weaveforge/desktop`.
UI checks run in the WeaveForge Dev build over CDP 9223 (`.agents/testing.md` §3–4), never the installed app.
