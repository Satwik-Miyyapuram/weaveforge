/**
 * The ink host's own types: what the host is handed, apart from its state.
 *
 * Extracted from `ink-host.tsx` so the host's file is the wiring and the
 * render, and the contract it serves is readable on its own — the hygiene
 * gate's split, named for the piece.
 */

import type { InkRecogniser, InkRecognitionHints } from "@weaveforge/core";

import type { PenHaptics } from "../application/pen-haptics";
import type { InkChunkStore, InkStoredPage } from "../application/ink-chunk-store";

/** A page as the host holds it: the sidecar's view of it. */
export type InkHostPage = InkStoredPage;

/** What the host needs from the container; the ink facade satisfies it. */
export interface InkHostDeps {
  chunks: InkChunkStore;
  /** Where a page background lives (§4.8): the vault's attachments. */
  assets: {
    upload(ownerId: string, blob: Blob, ext: string): Promise<string>;
    fetchBlob(path: string): Promise<Blob>;
  };
  recogniser: () => Promise<InkRecogniser | null>;
  hints: () => Promise<InkRecognitionHints>;
  /** The pen's actuator, where the platform can drive one; `null` elsewhere. */
  haptics?: () => Promise<PenHaptics | null>;
}

export interface InkHostProps {
  /** The note whose sidecar holds the pages. */
  noteId: string;
  /** The note's body: the ink header and the recognised text layer. */
  body: string;
  deps: InkHostDeps;
  /** The page the note opens on, 0-based. */
  initialPage?: number;
  /** Where the body goes when a page, the order or the text layer changes. */
  onSave?: (body: string) => Promise<void>;
}
