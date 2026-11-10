/**
 * Mattermost post rules (Rust `sync::mattermost_post`): the channel and origin for a post,
 * the response check and the test-post grouping. The fetch, the desktop bridge and the
 * signed-out event stay in `features/sync/infrastructure/mattermost-notifier.ts`.
 */
import {
  mattermostPostPlan as rawMattermostPostPlan,
  mattermostPostResponsePlan as rawMattermostPostResponsePlan,
  mattermostTestPosts as rawMattermostTestPosts,
} from "../pkg/wf_wasm.js";
import type {
  Integration,
  MattermostPostInput,
  MattermostPostPlan,
  MattermostPostResponse,
  MattermostPostResponsePlan,
  MattermostTestPost,
} from "./bindings.js";

export type {
  MattermostPostInput,
  MattermostPostPlan,
  MattermostPostResponse,
  MattermostPostResponsePlan,
  MattermostTestPost,
} from "./bindings.js";

/** The channel a post goes to and the origin it is sent to. */
export function mattermostPostPlan(input: MattermostPostInput): MattermostPostPlan {
  return rawMattermostPostPlan(input);
}

/** What to do with a Mattermost response: signed-out flag and error to throw. */
export function mattermostPostResponsePlan(
  input: MattermostPostResponse,
): MattermostPostResponsePlan {
  return rawMattermostPostResponsePlan(input);
}

/** One test post per channel the switched-on events route to. */
export function mattermostTestPosts(integration: Integration): MattermostTestPost[] {
  return rawMattermostTestPosts(integration);
}
