import { repoTail, WIRE } from "./tail.mjs";

const P = "packages/core/src/features/papers/application/parts-1.ts";
const UPD = "packages/core/src/features/papers/application/update-paper.use-case.ts";
const RS = "crates/wf-core/src/repos/papers.rs";
const AP = "apps/web/src/features/papers/application/parts-1.ts";
const FAC = "apps/web/src/container/facades/papers.ts";
const LIST = "apps/web/src/features/papers/ui/papers-list.tsx";
const CARD = "apps/web/src/features/papers/ui/paper-card.tsx";
const ZOT = "apps/web/src/features/papers/infrastructure/parts-3.ts";
const BIB = "apps/web/src/integrations/providers/zotero/bibliography-integration.ts";
const ZFAC = "apps/web/src/container/facades/zotero.ts";
const cache = { fn: "cachePaperRepository", path: WIRE, sym: "export function cachePaperRepository<" };
const tail = (n, by, method, sym) => repoTail(n, by, { cache, table: "papers", method, sym });

export default {
  id: "papers", name: "Papers", blurb: "Collect, read and cite the papers behind your thesis.",
  intro: "Most researchers go through Papers in this order. Pick what you want to do.",
  stages: [
    { name: "Bring papers in", journeys: ["add-doi", "zotero"] },
    { name: "Find your way around", journeys: ["library"] },
    { name: "Track your reading", journeys: ["status"] },
    { name: "Clean up", journeys: ["delete"] },
  ],
  journeys: [
    {
      id: "add-doi", name: "Add a paper by DOI",
      blurb: "Paste a DOI, arXiv id or link. WeaveForge fills in title, authors and year for you.",
      outcome: "The paper is on your board with title, authors and year filled in, and a note ready for reading notes.",
      help: { path: "docs/using/papers.md", heading: "Add a paper by pasting its reference" },
      steps: [
        { title: "Open the add form", text: "On the Papers board, click **Add paper**.", ui: "Add paper", hops: [1] },
        { title: "Paste the reference", text: "Paste a DOI like `10.1145/3290605.3300857`, an arXiv id or a link. WeaveForge works out which one it is.", hops: [2, 3, 4, 5] },
        { title: "WeaveForge looks it up", text: "It asks Crossref (or arXiv, OpenAlex…) for the title, authors and year.", hops: [6, 7] },
        { title: "Check for duplicates", text: "If the paper is already in your project, you get a notice instead of a second copy.", hops: [8, 9, 10, 11, 12, 13, 14, 15] },
        { title: "Saved", text: "The paper appears on the board with a note ready for your reading notes.", hops: [16] },
      ],
      chain: [
        { n: 1, layer: "ui", fn: "AddPaperForm submit", path: "apps/web/src/features/papers/ui/add-paper-form.tsx", sym: "papers.importPaper.importRef(" },
        { n: 2, by: 1, layer: "service", fn: "papers.importPaper", path: FAC, sym: "get importPaper() {" },
        { n: 3, by: 2, layer: "service", fn: "ImportPaperUseCase.importRef", path: P, sym: "async importRef(input: PaperRef" },
        { n: 4, by: 3, layer: "bridge", fn: "rust().parsePaperRef", path: P, sym: "rust().parsePaperRef(kind, value)" },
        { n: 5, by: 4, layer: "core", fn: "papers::paper_ref::parse_paper_ref", path: "crates/wf-core/src/papers/paper_ref.rs", sym: "pub fn parse_paper_ref(" },
        { n: 6, by: 3, layer: "service", fn: "MetadataResolver.resolve", path: P, sym: "async resolve(ref: PaperRef)" },
        { n: 7, by: 6, layer: "network", fn: "CrossrefMetadataSource.fetch", path: "apps/web/src/features/papers/infrastructure/parts.ts", sym: "async fetch(ref: PaperRef)", line: 67, note: "or arXiv / OpenAlex / Semantic Scholar / URL source" },
        { n: 8, by: 3, layer: "service", fn: "AddPaperUseCase.add", path: P, sym: "async add(input: NewPaperInput)" },
        { n: 9, by: 8, layer: "service", fn: "findDuplicate → repository.findByDoi", path: P, sym: "this.deps.repository.findByDoi(normDoi)" },
        ...tail(10, 9, "find_by_doi", "fn find_by_doi(call: &RepoCall)"),
        { n: 16, by: 8, layer: "core", fn: "papers::save", path: RS, sym: "fn save(call: &RepoCall)", note: "same tail as above, method save" },
      ],
      debug: [
        { see: "Nothing found for a DOI (Crossref answers 404 for DOIs it does not index)", check: 7 },
        { see: "Paper wrongly reported as a duplicate", check: 9 },
      ],
    },
    {
      id: "zotero", name: "Sync from Zotero",
      blurb: "Pull your Zotero library in with tags and annotations, and write your annotations back.",
      outcome: "Your Zotero papers and their annotations are in WeaveForge, and annotations you made here are in Zotero.",
      help: { path: "docs/using/integrations.md", heading: "Cloud Sync (Browser & Desktop)" },
      steps: [
        { title: "Open More", text: "On the Papers board, click **More**.", ui: "More", hops: [1] },
        { title: "Sync", text: "Choose **Sync Zotero**. WeaveForge compares both libraries and fetches what changed.", ui: "Sync Zotero", hops: [2, 3, 4, 5, 6, 7, 8, 9] },
        { title: "Annotations both ways", text: "Zotero annotations come in; annotations you made in WeaveForge go back to Zotero.", hops: [10, 11, 12] },
      ],
      chain: [
        { n: 1, layer: "ui", fn: "PapersList More menu", path: LIST, sym: "<Popover label=\"More\" ariaLabel=\"More actions\"" },
        { n: 2, by: 1, layer: "ui", fn: "Sync Zotero item", path: LIST, sym: "onSelect: () => void syncZotero()," },
        { n: 3, by: 2, layer: "ui", fn: "syncZotero", path: LIST, sym: "const syncZotero = useCallback(" },
        { n: 4, by: 3, layer: "service", fn: "ZoteroFacade.syncBibliography", path: ZFAC, sym: "async syncBibliography() {" },
        { n: 5, by: 4, layer: "service", fn: "BibliographyIntegration.syncLibrary", path: BIB, sym: "async syncLibrary() {" },
        { n: 6, by: 5, layer: "service", fn: "ZoteroSync.sync", path: ZOT, sym: "async sync(): Promise<ZoteroSyncResult>" },
        { n: 7, by: 6, layer: "service", fn: "ZoteroSync.snapshot", path: ZOT, sym: "private async snapshot() {" },
        { n: 8, by: 6, layer: "bridge", fn: "zoteroSyncPlan (wasm)", path: "crates/wf-wasm/src/papers_zotero_sync_plan.rs", sym: "js_name = zoteroSyncPlan," },
        { n: 9, by: 6, layer: "network", fn: "GET api.zotero.org …/items", path: ZOT, sym: "this.fetchFn(`${libraryUrl}/items`" },
        { n: 10, by: 4, layer: "service", fn: "BibliographyIntegration.pullAnnotations", path: BIB, sym: "async pullAnnotations(): Promise<BibliographyAnnotationPull>" },
        { n: 11, by: 10, layer: "network", fn: "ZoteroAnnotations.pull", path: "apps/web/src/features/papers/infrastructure/parts-2.ts", sym: "async pull(): Promise<ZoteroAnnotationPull>" },
        { n: 12, by: 4, layer: "service", fn: "ZoteroFacade.writeBackAnnotations", path: ZFAC, sym: "private async writeBackAnnotations()" },
      ],
      debug: [
        { see: "Sync reports nothing new although Zotero has new items", check: 8 },
        { see: "Sync fails with a Zotero error (key or library id)", check: 9 },
        { see: "Annotations made here never show up in Zotero", check: 12 },
      ],
    },
    {
      id: "library", name: "Browse your library",
      blurb: "Every paper in the project, as cards or a table, with search and filters.",
      outcome: "You see every paper in the project and can narrow the list by status, tags and reading lists.",
      help: { path: "docs/using/papers.md", heading: "How to" },
      steps: [
        { title: "Open Papers", text: "Click **Papers** in the sidebar. Cards are the default; switch to List for a table.", ui: "Papers", hops: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
        { title: "Narrow it down", text: "Type in the search box, or use **Filter papers** for status, tags and lists. Filtering runs in your browser, no extra calls.", ui: "Filter papers", hops: [1] },
      ],
      chain: [
        { n: 1, layer: "ui", fn: "PapersScreen loadScreen", path: LIST, sym: "const loadScreen = useCallback(async ()" },
        { n: 2, by: 1, layer: "service", fn: "papers.loadScreenData", path: FAC, sym: "loadScreenData() {" },
        { n: 3, by: 2, layer: "service", fn: "LoadPapersScreenUseCase.execute", path: AP, sym: "async execute(): Promise<PapersScreenData>" },
        { n: 4, by: 3, layer: "service", fn: "papers.listSummaries + lists.list", path: AP, sym: "this.deps.papers.listSummaries()," },
        ...tail(5, 4, "list_summaries", "fn list_summaries(call: &RepoCall)"),
      ],
      debug: [{ see: "Papers board stays empty or shows an error", check: 3 }],
    },
    {
      id: "status", name: "Mark reading status",
      blurb: "To read, reading, read: keep track from the card, the table or the note.",
      outcome: "The paper shows its new reading status everywhere.",
      help: null,
      steps: [
        { title: "Pick a status", text: "Use the status menu on a card. The table and the paper note have the same menu.", ui: "Reading status", hops: [1, 2] },
        { title: "Saved", text: "The card updates straight away.", hops: [3, 4, 5, 6, 7, 8, 9, 10] },
      ],
      chain: [
        { n: 1, layer: "ui", fn: "PaperCard changeStatus", path: CARD, sym: "papers.updatePaper.setStatus(paper.id, status)" },
        { n: 2, by: 1, layer: "service", fn: "UpdatePaperUseCase.setStatus", path: UPD, sym: "async setStatus(id: string, status: PaperStatus)" },
        { n: 3, by: 2, layer: "service", fn: "mutate (getById → save)", path: UPD, sym: "private mutate(id: string" },
        ...tail(4, 3, "get_by_id", "fn get_by_id(call: &RepoCall)"),
        { n: 10, by: 3, layer: "core", fn: "papers::save", path: RS, sym: "fn save(call: &RepoCall)" },
      ],
      debug: [{ see: "Status jumps back after a reload", check: 10 }],
    },
    {
      id: "delete", name: "Delete a paper",
      blurb: "Removes the paper, its images and its Zotero copy. You get a few seconds to undo.",
      outcome: "The paper, its pasted figures and its Zotero copy are gone.",
      help: null,
      steps: [
        { title: "Delete", text: "Open the card menu and click **Delete paper**.", ui: "Delete paper", hops: [1, 2, 3, 4] },
        { title: "Zotero copy removed", text: "If the paper came from Zotero, it is removed there too. If that fails, the delete still goes on.", hops: [5, 6] },
        { title: "Images and row removed", text: "Figures you pasted into the note go first, then the paper itself.", hops: [7, 8, 9, 10, 11, 12, 13, 14] },
      ],
      chain: [
        { n: 1, layer: "ui", fn: "PaperCard remove", path: CARD, sym: "const remove = () => removePaper(" },
        { n: 2, by: 1, layer: "ui", fn: "removePaper (undo toast)", path: "apps/web/src/features/papers/ui/remove-paper.ts", sym: "export function removePaper(" },
        { n: 3, by: 2, layer: "service", fn: "papers.deletePaper", path: FAC, sym: "deletePaper(paper: Paper) {" },
        { n: 4, by: 3, layer: "service", fn: "DeletePaperUseCase.execute", path: AP, sym: "async execute(paper: Paper): Promise<void>" },
        { n: 5, by: 4, layer: "service", fn: "bibliography.removeRemotePaper", path: AP, sym: "this.deps.bibliography.removeRemotePaper(zoteroKey)" },
        { n: 6, by: 5, layer: "network", fn: "ZoteroExporter.remove", path: "apps/web/src/features/papers/infrastructure/parts-2.ts", sym: "async remove(zoteroKey: string)", note: "DELETE api.zotero.org, best effort" },
        { n: 7, by: 4, layer: "storage", fn: "images.remove", path: AP, sym: "await this.deps.images.remove(img)" },
        { n: 8, by: 4, layer: "service", fn: "UpdatePaperUseCase.remove", path: UPD, sym: "async remove(id: string): Promise<void>" },
        ...tail(9, 8, "delete", "fn delete(call: &RepoCall)"),
      ],
      debug: [
        { see: "Paper comes back after the undo time ran out", check: 13 },
        { see: "Paper deleted here but still in Zotero", check: 6 },
      ],
    },
  ],
};
