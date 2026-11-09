/**
 * Mattermost notification events and routing (Rust `sync::mattermost_options`),
 * re-exported from index.ts.
 */
import {
  mattermostChannelFor as rawMattermostChannelFor,
  mattermostEvents as rawMattermostEvents,
  mattermostOptions as rawMattermostOptions,
} from "../pkg/wf_wasm.js";
import type {
  Integration,
  MattermostEvent,
  MattermostEventInfo,
  MattermostOptions,
} from "./bindings.js";

export type { MattermostEvent, MattermostEventInfo, MattermostOptions };

/** The settings rows, in panel order (was the `MATTERMOST_EVENTS` constant). */
export function mattermostEvents(): MattermostEventInfo[] {
  return rawMattermostEvents() as MattermostEventInfo[];
}

export function mattermostOptions(i: Integration): MattermostOptions {
  return rawMattermostOptions(i) as MattermostOptions;
}

/** Channel this event posts to, or null when the event is switched off. */
export function mattermostChannelFor(i: Integration, event: MattermostEvent): string | null {
  return rawMattermostChannelFor(i, event) ?? null;
}
