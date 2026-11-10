/**
 * Settings rail group label and hint (Rust `rail_group_text`), re-exported from index.ts.
 * The shapes come from bindings.ts, generated from the Rust types.
 */
import { railGroupText as rawRailGroupText } from "../pkg/wf_wasm.js";
import type { RailGroupText, RailGroupWords } from "./bindings.js";

export type { RailGroupText, RailGroupWords } from "./bindings.js";

/**
 * The label and hint for a rail group, given the visible tabs and the integration titles.
 */
export function railGroupText(
  group: RailGroupWords,
  visible: readonly string[],
  integrationTitles: readonly string[],
): RailGroupText {
  return rawRailGroupText(group, visible, integrationTitles) as RailGroupText;
}
