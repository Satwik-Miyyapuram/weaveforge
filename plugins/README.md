# Deploy-time plugins

## Enable a plugin

1. Edit `weaveforge.config.ts` at the repo root and list the plugin:

```ts
import { defineConfig } from "@weaveforge/core";
import { myPlugin } from "my-weaveforge-plugin";

export default defineConfig({
  plugins: [myPlugin()],
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
