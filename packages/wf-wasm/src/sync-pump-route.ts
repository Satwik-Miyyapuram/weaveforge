/**
 * Outbox pump routing (Rust `sync::pump_route`), re-exported from modules.ts. Picks the step
 * for one send outcome. Called from `domain/pump.ts`. The types are hand-written here: the
 * serialized forms are the Rust enums in lowercase and the struct fields in camelCase.
 */
import { pumpRoute as rawPumpRoute } from "../pkg/wf_wasm.js";

/** How the transport answered one send. */
export type PumpSendStatus = "offline" | "accepted" | "conflict" | "refused";

/** The step the pump takes for one op. */
export type PumpRouteAction = "stop" | "settle" | "conflict" | "wait" | "fail";

export interface PumpRouteInput {
  status: PumpSendStatus;
  opIsDelete: boolean;
  hasNewVersion: boolean;
  awaitingParent: boolean;
}

export interface PumpRoute {
  action: PumpRouteAction;
  ack: boolean;
  stall: boolean;
}

/** The route for one send outcome. */
export function pumpRoute(input: PumpRouteInput): PumpRoute {
  return rawPumpRoute(input) as PumpRoute;
}
