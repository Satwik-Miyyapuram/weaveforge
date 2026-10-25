import v8 from "node:v8";
import vm from "node:vm";

/**
 * One full garbage collection, now.
 *
 * Main has no `gc` global, and `--js-flags` cannot give it one: Electron reads
 * that switch for renderers. The flag is switched on just long enough for a
 * fresh context to hand over its `gc`, then off again, so nothing else in
 * main ever sees one. Returns whether a collection ran.
 */
export function collectGarbage(): boolean {
  try {
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    gc();
    return true;
  } catch {
    return false;
  } finally {
    v8.setFlagsFromString("--no-expose-gc");
  }
}
