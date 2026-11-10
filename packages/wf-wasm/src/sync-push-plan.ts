/**
 * Push and pull gates for the offline-sync engine (Rust `sync::push_plan`), re-exported from
 * modules.ts. Called from `domain/sync-engine.ts` and `domain/puller.ts`.
 */
import {
  continuePushRound as rawContinuePushRound,
  groupEligible as rawGroupEligible,
  shouldFetchNextPage as rawShouldFetchNextPage,
  shouldPullAfterPush as rawShouldPullAfterPush,
  shouldRecoverUnsent as rawShouldRecoverUnsent,
} from "../pkg/wf_wasm.js";

export {
  tableGroups,
} from "../pkg/wf_wasm.js";

/** Whether the push loop runs another round. */
export function continuePushRound(input: { sent: number; stoppedEarly: boolean }): boolean {
  return rawContinuePushRound(input.sent, input.stoppedEarly);
}

/** Whether unsent local rows are checked against the server. */
export function shouldRecoverUnsent(input: { hasAccount: boolean; resendChecked: boolean }): boolean {
  return rawShouldRecoverUnsent(input.hasAccount, input.resendChecked);
}

/** Whether a refused pull may land in a table-wide group. */
export function groupEligible(input: { deleted: boolean; uniqueClash: boolean; pendingOps: number }): boolean {
  return rawGroupEligible(input.deleted, input.uniqueClash, input.pendingOps);
}

/** Whether the pull runs after a push (not when the network stopped the push). */
export function shouldPullAfterPush(input: { stoppedOffline: boolean }): boolean {
  return rawShouldPullAfterPush(input.stoppedOffline);
}

/** Whether the cycle fetches another page; `page` counts the pulls already made. */
export function shouldFetchNextPage(input: { more: boolean; page: number; maxPages: number }): boolean {
  return rawShouldFetchNextPage(input.more, input.page, input.maxPages);
}

