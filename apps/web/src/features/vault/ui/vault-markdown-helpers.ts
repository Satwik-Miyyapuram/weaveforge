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

export { assetOrNull } from "@/lib/hooks/use-vault-markdown-source";
