import { readyCore } from "@/lib/rust-core";

/** The local calendar day of `now` as `yyyy-mm-dd`, the form the plan timeline takes as "today". */
export function localIsoDay(now: Date = new Date()): string {
  return readyCore().isoDayFromParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
