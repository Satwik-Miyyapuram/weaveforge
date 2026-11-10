/**
 * Overleaf link rules (Rust `overleaf_link`), re-exported from index.ts. The types mirror the Rust
 * structs; they are not in bindings.ts yet.
 */
import {
  checkOverleafLinkFolder as rawCheckOverleafLinkFolder,
  parseOverleafLinks as rawParseOverleafLinks,
} from "../pkg/wf_wasm.js";

/** One Overleaf project linked to a vault folder. */
export interface OverleafLinkRow {
  projectId: string;
  /** Vault-relative, forward slashes. */
  folder: string;
}

/** Whether a vault folder may be linked: the normalised folder, or the reason it may not. */
export type OverleafLinkFolderCheck = { ok: true; folder: string } | { ok: false; reason: string };

/** Check a vault-relative folder. A non-string is refused, as the Rust side takes only strings. */
export function checkOverleafLinkFolder(raw: unknown): OverleafLinkFolderCheck {
  if (typeof raw !== "string") {
    return { ok: false, reason: "Choose a folder inside the vault, like Overleaf/thesis." };
  }
  return rawCheckOverleafLinkFolder(raw) as OverleafLinkFolderCheck;
}

/** The well-formed links in stored JSON. A non-string value gives no links. */
export function parseOverleafLinks(stored: unknown): OverleafLinkRow[] {
  if (typeof stored !== "string") return [];
  return rawParseOverleafLinks(stored) as OverleafLinkRow[];
}
