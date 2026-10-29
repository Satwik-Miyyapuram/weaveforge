import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";

/**
 * The element id a `#heading` / `#^blockid` hash points at. A malformed escape
 * (`#%E0`) would make `decodeURIComponent` throw inside an effect and blank the
 * note, so it is used as written instead.
 */
export function hashTargetId(hash: string): string {
  try {
    return decodeURIComponent(hash);
  } catch {
    return hash;
  }
}

/** One note image: a failed fetch drops the image, and the log says which. */
export async function assetOrNull(fetch: (path: string) => Promise<Blob | null>, path: string): Promise<Blob | null> {
  try {
    return await fetch(path);
  } catch (err) {
    logToApp({
      level: "warn",
      source: "vault",
      message: "A note image could not load",
      detail: `${path}: ${formatError(err)}`,
    });
    return null;
  }
}
