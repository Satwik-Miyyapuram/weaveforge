/**
 * Sync phase rules (Rust `sync::sync_phase`), re-exported from index.ts.
 */
import {
  afterCycle as rawAfterCycle,
  afterFailure as rawAfterFailure,
  initialPhase as rawInitialPhase,
} from "../pkg/wf_wasm.js";

export {
  isCaughtUp,
} from "../pkg/wf_wasm.js";

/** The status the sync panel shows. */
export type SyncPhase = "idle" | "offline" | "error";

/** The phase and connectivity a finished or failed cycle leaves behind. */
export interface CyclePhase {
  phase: SyncPhase;
  isOnline: boolean;
}

/** After a cycle that ran: offline when the push stopped for lack of a connection, idle otherwise. */
export function afterCycle(stoppedBecause: string | null): CyclePhase {
  return rawAfterCycle(stoppedBecause) as CyclePhase;
}

/** After a cycle that threw: an error while online, offline otherwise. */
export function afterFailure(online: boolean): CyclePhase {
  return rawAfterFailure(online) as CyclePhase;
}

/** The phase before the first cycle. */
export function initialPhase(online: boolean): SyncPhase {
  return rawInitialPhase(online) as SyncPhase;
}
