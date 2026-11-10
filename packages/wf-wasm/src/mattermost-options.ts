/**
 * Mattermost notification events and routing (Rust `sync::mattermost_options`),
 * re-exported from index.ts.
 */
import {
  mattermostChannelFor as rawMattermostChannelFor,
} from "../pkg/wf_wasm.js";
import type {
  Integration,
  MattermostEvent,
  MattermostEventInfo,
  MattermostOptions,
} from "./bindings.js";

export {
  mattermostEvents,
  mattermostOptions,
} from "../pkg/wf_wasm.js";

export type { MattermostEvent, MattermostEventInfo, MattermostOptions };

/** Channel this event posts to, or null when the event is switched off. */
export function mattermostChannelFor(i: Integration, event: MattermostEvent): string | null {
  return rawMattermostChannelFor(i, event) ?? null;
}
