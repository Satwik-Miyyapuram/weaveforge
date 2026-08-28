# Deploy-time plugins

Example plugin: `apps/web/src/plugins/example/`

## Enable the timer demo

1. Edit `weaveforge.config.ts` at the repo root:

```ts
import { defineConfig } from "@weaveforge/core";
import { exampleTimerPlugin } from "./apps/web/src/plugins/example";

export default defineConfig({
  plugins: [exampleTimerPlugin()],
});
```

2. Generate the App Router stub (if missing):

```bash
npm run generate:routes
```

3. Redeploy / restart dev server.

## Integration plugins

Export a `WebWeaveForgePlugin` with `integrationManifests` from your package.
See `docs/using/extensions.md` and `apps/web/src/integrations/manifests/`.
