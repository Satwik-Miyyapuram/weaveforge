# Settings core module

The `settings` module holds the pure rules for user settings: how settings and
integration credentials are hydrated and normalised, how appearance preferences
are cleaned, and how an uploaded theme config file is parsed and checked. It
treats the theme file as untrusted input. It does no I/O.

## What lives in Rust

Source: `crates/wf-core/src/settings/`

- `user_settings.rs`: hydrates and normalises user settings and applies integration fields.
- `user_appearance.rs`: normalises the appearance preferences.
- `theme_config.rs`: parses the uploadable theme config file. It checks colours, font stacks and lengths against allowlists and caps the file at 64 KB.
- `integration_credentials.rs`: reads integration fields and checks whether an integration is connected. It also converts the legacy credentials layout.
- `workspace_settings.rs`: reads and writes the shared workspace file `.weaveforge/settings.json` (workspace id, tier, tier epoch, tier account and server hint). It keeps fields it does not know, so an older or newer app can share the file.

### The workspace id

Each workspace folder gets its own id: a random UUID version 4. The desktop
shell makes it the first time the folder opens (`stamp_workspace_id` in
`apps/shell/src/cmd_vault.rs`) and saves it in `.weaveforge/settings.json`
through `WorkspaceSettings::ensure_workspace_id`. Later opens read it back and
never change it, so the id stays the same across restarts. Two folders never
share an id, even when their git history starts the same way.

The file is committed with the rest of the workspace (the git exclude list lets
`settings.json` through), so a clone on another computer sees the same id. If
two copies were stamped before they ever synced, the tier merge keeps the
smaller id. The id lives in this one file on purpose, so later work on the
workspace files (lane L7) can adopt it without a second source.

`mod.rs` describes the module as user settings (the uploadable theme config
file and appearance preferences), pure rules only.

## How the app calls it

The wasm exports live in `crates/wf-wasm/src` (`user_settings.rs`,
`user_appearance.rs`, `theme_config.rs`, `integration_credentials.rs`). The
TypeScript wrappers in `packages/wf-wasm/src` import the raw names from
`../pkg/wf_wasm.js` and re-export them. The main names are:

- User settings: `hydrateUserSettings`, `normalizeUserSettings`,
  `applyUserIntegrationFields`, `needsDisclaimerAcceptance`.
- Appearance: `normalizeAppearance`.
- Theme config: `parseThemeConfig`,
  `normalizeThemeConfig`, `themeConfigTemplate`.
- Integration credentials: `getUserIntegrationField`, `isUserIntegrationConnected`,
  `integrationsBagFromLegacy`.

The `user_settings` row queries run in Rust (`repos/user_settings.rs`, see
[data-access](data-access.md)).

Code in `apps/web` reads these through `readyCore()` or `typedCore()` from
`apps/web/src/lib/rust-core.ts`, or through the wrappers in `packages/wf-wasm`.
`readyCore()` throws until `loadCore()` has resolved, so call it only after
the core has loaded.

## What stays in TypeScript, and why

- **Persistence and use cases.** Loading and saving settings and credentials
  through the database, and the use cases that call them, stay in
  `packages/core/src/features/settings`. Rust normalises the values it is given;
  it never stores them.
- **File reading.** The browser reads the uploaded theme file and passes its
  text to Rust. Rust does the size check and the parse, so the rule applies the
  same way in every caller.
- **Hooks and screens.** The settings screens, the theme preview and the
  appearance controls stay in `apps/web`.
- **Type contracts.** The TypeScript types for settings, appearance and theme
  shapes stay in `packages/core` and `packages/wf-wasm/src`, because the app
  type-checks against them.

## Related

- [AI core](ai.md)
- [Dashboard core](dashboard.md)
- [Plan core](plan.md)
- [Logbook core](logbook.md)

Source: `crates/wf-core/src/settings/`
