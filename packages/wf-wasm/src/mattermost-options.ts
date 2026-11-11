/**
 * Mattermost notification events and routing (Rust `sync::mattermost_options`),
 * re-exported from index.ts.
 */
import type {
  MattermostEvent,
  MattermostEventInfo,
  MattermostOptions,
} from "./bindings.js";

export {
  mattermostChannelFor,
  mattermostEvents,
  mattermostOptions,
} from "../pkg/wf_wasm.js";

export type { MattermostEvent, MattermostEventInfo, MattermostOptions };
