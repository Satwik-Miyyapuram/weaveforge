import type { Clock, IdGenerator } from "../shared/clock.js";

/** A clock that never moves, so a test asserting on a timestamp has one to name. */
export function fixedClock(iso = "2026-06-24T12:00:00.000Z"): Clock {
  return { nowIso: () => iso };
}

/** Ids in order — `id-1`, `id-2` — so an assertion can name the row it means. */
export function seqIds(): IdGenerator {
  let n = 0;
  return { newId: () => `id-${++n}` };
}
