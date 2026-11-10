/**
 * Sync integration field accessors (Rust `sync::integration_fields`),
 * re-exported from index.ts.
 *
 * Storage keeps one shape (`token`, `repo`, `branch`) for every provider; each
 * provider reads those keys with its own meaning.
 */
import type {
  Integration,
} from "./bindings.js";

export {
  emptyIntegration,
  gitConnection,
  gitConnectionReady,
  mattermostConnection,
  mattermostConnectionReady,
} from "../pkg/wf_wasm.js";

export type { Integration as IntegrationInput } from "./bindings.js";

