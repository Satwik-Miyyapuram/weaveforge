/**
 * Ink notes: where a note's stroke chunks live, and which engine reads them.
 *
 * The chunk store is routed per call — the workspace folder's `.ink/` when one
 * is open, the encrypted asset bucket otherwise — so an ink note follows the
 * same rule as every other page: on disk if there is a disk, in the vault if
 * not. The recogniser is chosen once per session by core's selector, in §5.2's
 * order, from the candidates this build can offer; MyScript joins the list only
 * when the settings hold a key, which is what keeps "text never leaves the
 * machine" true by construction rather than by a checkbox.
 */

import {
  inkVocabularyHints,
  selectInkRecogniser,
  type InkRecogniser,
  type InkRecognitionHints,
  type MyScriptOptions,
} from "@weaveforge/core";

import type { InkChunkStore } from "@/features/ink/application/ink-chunk-store";
import {
  createPenHaptics,
  type PenHaptics,
} from "@/features/ink/application/pen-haptics";
import { inkRecogniserCandidates } from "@/features/ink/application/recognisers";
import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";

/** The slice of the vault's asset store a page background needs. */
export interface InkAssetStore {
  upload(ownerId: string, blob: Blob, ext: string): Promise<string>;
  fetchBlob(path: string): Promise<Blob>;
}

export class InkFacade {
  private selected: Promise<InkRecogniser | null> | null = null;
  private hapticsProbe: Promise<PenHaptics | null> | null = null;
  private boundAssets: InkAssetStore | null = null;

  constructor(
    private readonly deps: {
      chunks: InkChunkStore;
      /** Where a page background (an inserted PDF page, §4.8) is kept: the vault's attachments. */
      assets: InkAssetStore;
      bridge: () => DesktopBridge | null;
      /** The opt-in, read when a recogniser is first asked for. */
      myScript: () => Promise<MyScriptOptions | undefined>;
      /** Titles the vocabulary hints are built from. */
      vocabulary: () => Promise<readonly (readonly string[])[]>;
    },
  ) {}

  get chunks(): InkChunkStore {
    return this.deps.chunks;
  }

  /**
   * The store's methods, bound: the host hands `assets.fetchBlob` to hooks
   * as a bare function, and a class method called without its receiver
   * loses `this.blobs` (the same trap 7c63a64 closed for the recogniser).
   * Built once, so a hook keyed on the function does not refetch per render.
   */
  get assets(): InkAssetStore {
    if (!this.boundAssets) {
      const store = this.deps.assets;
      this.boundAssets = {
        upload: store.upload.bind(store),
        fetchBlob: store.fetchBlob.bind(store),
      };
    }
    return this.boundAssets;
  }

  /** Every engine this build knows of, available or not, for the settings panel. */
  async candidates(): Promise<InkRecogniser[]> {
    let myScript: MyScriptOptions | undefined;
    try {
      myScript = await this.deps.myScript();
    } catch {
      myScript = undefined;
    }
    return inkRecogniserCandidates({ bridge: this.deps.bridge, myScript });
  }

  /**
   * The engine for this session, probed once and kept (§5.2). `null` means no
   * engine is available here, and the bar says so rather than failing a run.
   */
  recogniser(): Promise<InkRecogniser | null> {
    this.selected ??= this.candidates().then(selectInkRecogniser);
    return this.selected;
  }

  /** Forget the choice, for when the opt-in changes. */
  reset(): void {
    this.selected = null;
  }

  /**
   * The pen's haptics (ink-native-bridges.md §4), where the desktop app's OS
   * can drive them; `null` everywhere else. Probed once: the answer is the
   * machine's, not the note's.
   */
  haptics(): Promise<PenHaptics | null> {
    this.hapticsProbe ??= (async () => {
      const bridge = this.deps.bridge();
      if (!bridge || typeof bridge.inkHapticsAvailable !== "function")
        return null;
      try {
        return (await bridge.inkHapticsAvailable())
          ? createPenHaptics(bridge)
          : null;
      } catch {
        return null;
      }
    })();
    return this.hapticsProbe;
  }

  /** The hints handed to an engine: the workspace's titles and keys, capped. */
  async hints(lang = "en"): Promise<InkRecognitionHints> {
    let sources: readonly (readonly string[])[] = [];
    try {
      sources = await this.deps.vocabulary();
    } catch {
      sources = [];
    }
    return { vocabulary: inkVocabularyHints(sources), lang };
  }
}
