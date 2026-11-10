/**
 * Mattermost post rules (Rust `sync::mattermost_post`): the channel and origin for a post,
 * the response check and the test-post grouping. The fetch, the desktop bridge and the
 * signed-out event stay in `features/sync/infrastructure/mattermost-notifier.ts`.
 */
import type {
  MattermostPostInput,
  MattermostPostPlan,
  MattermostPostResponse,
  MattermostPostResponsePlan,
  MattermostTestPost,
} from "./bindings.js";

export {
  mattermostPostPlan,
  mattermostPostResponsePlan,
  mattermostTestPosts,
} from "../pkg/wf_wasm.js";

export type {
  MattermostPostInput,
  MattermostPostPlan,
  MattermostPostResponse,
  MattermostPostResponsePlan,
  MattermostTestPost,
} from "./bindings.js";

