import type { AddPaperUseCase, IPaperRepository, ManageTagsUseCase } from "@weaveforge/core";
import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import { applyBibliographyAnnotations } from "@/integrations/providers/zotero/bibliography-integration";

/**
 * The Zotero running on this computer: its papers, then their annotations.
 *
 * Separate from `syncBibliography`, which reads the cloud library with an API
 * key. This one needs no key and no account: Zotero 7 serves a read-only copy of
 * the same API on loopback, and the desktop shell is what reaches it. Items not
 * yet in the library become papers first — a copy with no account has no other
 * way to fill its shelf — and annotations are then matched by the `zoteroKey`
 * every pulled paper carries.
 *
 * This orchestration used to be a method on `PapersFacade`, which is where the
 * findings against that class come from: a facade is a screen's view of the
 * container, and this is a workflow. Worse, it reached for the desktop bridge
 * itself, so the only way to test any part of it was to have an Electron shell
 * on the other side. The bridge is injected now, which is the whole point — a
 * test passes the object `desktop()` would have returned.
 */

export interface LocalZoteroImportResult {
  /**
   * How many items the local library added as papers.
   *
   * A count, not the papers: `ZoteroSync.pull()` returns how many it created,
   * and the screen says "3 new papers". The declaration said otherwise for a
   * moment during this extraction and the compiler caught it at the call site,
   * which is the argument for the return type being written down at all.
   */
  papers: number;
  /** How many papers the annotations landed on. */
  annotations: number;
  /** Items the local Zotero answered with. */
  items: number;
}

export class ImportLocalZoteroUseCase {
  constructor(
    private readonly deps: {
      papers: IPaperRepository;
      addPaper: AddPaperUseCase;
      manageTags: ManageTagsUseCase;
      /**
       * The desktop bridge, or null anywhere but the desktop shell.
       *
       * Async so the composition root can keep importing it lazily: the bridge
       * is only meaningful inside the shell, and the browser build has no use
       * for it. A test supplies a fake and never touches Electron.
       */
      bridge: () => Promise<DesktopBridge | null>;
      /**
       * The Zotero collection this project syncs to, or `undefined` for the
       * whole library.
       *
       * The same per-project setting the cloud sync reads — `projects.zotero_collection`,
       * chosen in Settings — so "read Zotero on this computer" imports the
       * collection the reader is actually working on rather than all 4,000
       * items of their library. Absent means the whole library, which is what a
       * reader who has never picked a collection gets, and is also what the
       * cloud path does.
       *
       * A function rather than a value because the project can change between
       * mounts, and the import must read the setting as it stands when it runs.
       */
      collection?: () => Promise<string | undefined>;
    },
  ) {}

  async execute(): Promise<LocalZoteroImportResult> {
    const bridge = await this.deps.bridge();
    if (!bridge || typeof bridge.zoteroLocal !== "function") {
      throw new Error("Reading the local Zotero needs the WeaveForge desktop app.");
    }

    // Imported here rather than at the top of the file so a browser build does
    // not carry the local-Zotero client: it exists for the desktop shell, and
    // only the desktop shell can reach it.
    const { localZoteroAnnotations, localZoteroLibrary } = await import(
      "@/features/papers/infrastructure/zotero-local"
    );

    const collection = this.deps.collection;

    const papers = await localZoteroLibrary(
      bridge,
      {
        listPapers: () => this.deps.papers.list(),
        addPaper: (input) => this.deps.addPaper.addManual(input),
        onItemTags: async (paper, remote) => {
          const names = (remote.tags ?? []).map((t) => t.tag ?? "").filter(Boolean);
          if (names.length === 0) return;
          await this.deps.manageTags.reconcileSources(
            paper.id,
            names.map((name) => ({ name, source: "zotero_item" as const })),
            ["zotero_item"],
          );
        },
      },
      collection,
    ).pull();

    // Scoped to the same collection as the papers, or the annotations would
    // arrive for papers the import deliberately did not take.
    const byPaper = await localZoteroAnnotations(bridge, collection).pullAll();
    const annotations = await applyBibliographyAnnotations(
      byPaper,
      this.deps.papers,
      this.deps.manageTags,
    );
    return { papers, annotations, items: byPaper.size };
  }
}
