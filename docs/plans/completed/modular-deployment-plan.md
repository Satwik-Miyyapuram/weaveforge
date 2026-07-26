# Modular deployment plan

WeaveForge already has the right dependency direction for modular deployments:
domain contracts live in `packages/core`, concrete adapters live at the web
composition root, and integrations are described by manifests. The remaining
work is to make the deployment configuration control both visibility and the
compiled bundle.

## Configuration contract

`thesis-tracker.config.ts` keeps every built-in component when `builtins` is
omitted. An explicit allowlist can narrow a deployment:

```ts
export default defineConfig({
  builtins: {
    features: ["dashboard", "papers", "report", "settings"],
    integrations: ["zotero", "semantic-scholar"],
  },
  plugins: [],
});
```

The generated registry is created by `npm run generate:deployment` and contains
only selected built-in imports. MCP is independently selected through
`mcp.enabled` and its tool allowlist; disabled deployments omit the proposal
executor import and return `404` from MCP/token/relay routes. Plugin packages
remain additive and can contribute feature modules or integration manifests.

## What can be modular

| Boundary | Current shape | Safe configuration boundary |
| --- | --- | --- |
| Research features | `FeatureModule` descriptors | Feature allowlist; keep dashboard/auth/settings available for usable deployments |
| Integrations | Typed integration manifests | Provider allowlist; disabled providers are not selectable or wired |
| MCP | Relay routes, tool registry, proposal executors | MCP on/off plus tool-capability allowlist; never compile credentials or secrets into the client |
| Storage | Supabase and tiered/blob providers | Server-side storage-provider selection |
| Database backend | Supabase and Postgres adapters | Server-side backend-provider selection |
| Optional plugins | `ThesisTrackerPlugin` modules/manifests | Additive npm packages configured by the deployment |
| Background jobs | Explicit bootstrap gates | Environment/config feature flags |

## Build-time validation

The build-time registry excludes unselected built-in feature and integration
imports, emits the MCP capability surface, and generates a separate route
registry so route pages import only selected screens. It is checked by
`npm run check:deployment-surface`.

1. generate route stubs only for selected feature modules;
2. fail the build if a disabled provider is referenced by an enabled module; and
3. add bundle-size and route-surface checks to CI.

This preserves a normal default build while allowing small self-hosted images,
lab deployments, and privacy-focused builds that do not ship unused external
connectors.

## Security rules

- Configuration controls code and wiring, not user-level authorization.
- AI/MCP access remains separately opt-in at runtime and must still pass the
  encryption, disclosure, source, grant, and proposal-review gates.
- Provider credentials remain server-only or browser-unlocked encrypted data;
  they must never be placed in `NEXT_PUBLIC_*` variables or generated bundles.
- Disabling an integration must not disable the RLS policies protecting its
  stored configuration. Database migrations remain the single schema source of
  truth.

## Recommended implementation order

1. Complete registry allowlists and tests (current phase).
2. Add build-time registry generation and route validation.
3. Split MCP into a separately selectable capability bundle with its own
   server routes and proposal executor registry.
4. Add provider/plugin package boundaries for Zotero, Git providers,
   Mattermost, Overleaf, and future providers.
5. Add bundle-size and route-surface checks to CI.
