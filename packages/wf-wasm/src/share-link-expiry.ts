/**
 * Default expiry of a new view link (Rust `sharing::default_share_link_expires_at`), re-exported
 * from index.ts. Takes the time as epoch milliseconds so Rust stays clock-free.
 */
import { defaultShareLinkExpiresAt as rawDefaultShareLinkExpiresAt } from "../pkg/wf_wasm.js";

/** The expiry `SHARE_LINK_DEFAULT_TTL_DAYS` after `nowMs`, as ISO-8601 UTC. */
export function defaultShareLinkExpiresAt(nowMs: number): string {
  return rawDefaultShareLinkExpiresAt(nowMs);
}
