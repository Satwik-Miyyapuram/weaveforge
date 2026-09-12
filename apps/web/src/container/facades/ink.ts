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
import { inkRecogniserCandidates } from "@/features/ink/application/recognisers";
import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";

export class InkFacade {
  private selected: Promise<InkRecogniser | null> | null = null;

  constructor(
    private readonly deps: {
      chunks: InkChunkStore;
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
