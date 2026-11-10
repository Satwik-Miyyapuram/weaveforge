import { readyCore } from "@/lib/rust-core";

/**
 * An Enter that commits a field: not the one that confirms an IME composition
 * (`isComposing`, or keyCode 229 on older engines). Without this, a Japanese or
 * Chinese word saves half-typed the moment its characters are confirmed.
 */
export function isCommitEnter(event: {
  key: string;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean };
}): boolean {
  return readyCore().isCommitEnter(event.key, event.keyCode, !!event.nativeEvent?.isComposing);
}
