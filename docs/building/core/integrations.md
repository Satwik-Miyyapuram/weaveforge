# Integrations core module

The `integrations` module holds the pure rules for external integrations: which
provider is selected, whether a gate lets an integration show, which connections
count as ready, and how bibliography annotations change papers. It holds no
credentials and makes no calls. The app reads the settings, passes them in, and
acts on the answer.

## What lives in Rust

Each file under `crates/wf-core/src/integrations/` covers one job:

- `mod.rs`: registers the submodules and states that the rules come from the TypeScript integration code.
- `config.rs`: selects the integration providers from the values it is given.
- `gates.rs`: decides which integration descriptors show, from the user and project gates.
- `shared_provider_hint.rs`: builds the "same stored credentials" hint under a project sync descriptor.
- `bibliography_annotations.rs`: works out which papers a pulled annotation set changes, and the summary of those changes.

## How the app calls it

The wasm exports live in `crates/wf-wasm/src` (for example `integration_config.rs`,
`integration_hint.rs` and `integration_bibliography.rs`). The TypeScript wrappers
in `packages/wf-wasm/src` import the raw names from `../pkg/wf_wasm.js` and
re-export them. The main names are:

- Config and gates: `resolveIntegrationConfig`, `userGateOpen`, `projectGateOpen`, `gitlabCombinedActive`.
- Hints: `sharedProviderHint`.
- Bibliography: `planBibliographyAnnotations`.
- Connection state: `getUserIntegrationField`, `isUserIntegrationConnected`, `integrationsBagFromLegacy`, `gitConnection`, `mattermostConnection`, `gitConnectionReady`, `mattermostConnectionReady`, `emptyIntegration`.

Code in `apps/web` reads these through `readyCore()` or `typedCore()` from
`apps/web/src/lib/rust-core.ts`, or through the wrappers in `packages/wf-wasm`.
`readyCore()` throws until `loadCore()` has resolved, so call it only after the
core has loaded.

## What stays in TypeScript, and why

- **Credentials.** Storing, reading and encrypting tokens stays in TypeScript and
  the database. Rust sees only whether a connection is present and ready. It never
  handles a secret.
- **Provider calls.** Calls to GitLab, Mattermost and the bibliography services
  stay in TypeScript. Rust plans what to change; the app makes the change.
- **Environment reads.** The app reads its environment and settings, then passes
  the values into `resolveIntegrationConfig`. Rust does not read the process
  environment.
- **Orchestration.** Running a sync, showing a pull result and saving the
  annotations stay in TypeScript use cases.
- **Hooks and UI.** The settings screens, the connect buttons and the status
  badges stay in `apps/web`.
- **Thin wrappers.** The files in `packages/wf-wasm/src` (for example
  `integration-config.ts`, `integration-hint.ts` and `integration-bibliography.ts`)
  only forward to the raw exports, so they keep no rules of their own.

Source: `crates/wf-core/src/integrations/`
