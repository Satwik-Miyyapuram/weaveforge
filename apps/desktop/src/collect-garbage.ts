import v8 from "node:v8";
import vm from "node:vm";

/**
 * Two full garbage collections, one tick apart.
 *
 * Main has no `gc` global, and `--js-flags` cannot give it one: Electron reads
 * that switch for renderers. The flag is switched on just long enough for a
 * fresh context to hand over its `gc`, then off again, so nothing else in
 * main ever sees one.
 *
 * Two passes because one is not enough in Electron main: the first runs the
 * weak callbacks that let go of the boot's external buffers, and only the
 * second, after those callbacks have run, frees them (measured: 39 -> 39 MB
 * external after one pass, 21 MB after two). Resolves to whether both ran.
 */
export async function collectGarbage(): Promise<boolean> {
  let gc: () => void;
  try {
    v8.setFlagsFromString("--expose-gc");
    gc = vm.runInNewContext("gc") as () => void;
  } catch {
    return false;
  } finally {
    v8.setFlagsFromString("--no-expose-gc");
  }
  try {
    gc();
    await new Promise<void>((resolve) => setImmediate(resolve));
    gc();
    return true;
  } catch {
    return false;
  }
}
