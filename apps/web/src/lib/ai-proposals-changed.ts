/** Fired after anything changes the AI review queue. */
export const AI_PROPOSALS_CHANGED_EVENT = "ai-proposals-changed";

/**
 * Say the review queue changed. The pending memo goes first, so whichever
 * listener reads next gets the new queue, not the cached one.
 */
export function announceAiProposalsChanged(proposals: { forgetPending(): void }): void {
  proposals.forgetPending();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AI_PROPOSALS_CHANGED_EVENT));
}
