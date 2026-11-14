import { repoTail, WIRE } from "./tail.mjs";

const VS = "apps/web/src/features/vault/ui/vault-screen/vault-screen.tsx";
const PE = "apps/web/src/features/vault/ui/vault-screen/page-editor.tsx";
const PARTS = "apps/web/src/features/vault/application/parts.ts";
const FAC = "apps/web/src/container/facades/index.ts";
const cache = { fn: "cacheRepo(rustVaultPageRepository)", path: WIRE, sym: "const rawVaultPageRepository = cacheRepo(" };
const facade = (n, by) => ({ n, by, layer: "service", fn: "VaultFacade.manageVaultPage", path: FAC, sym: "get manageVaultPage() {" });
const tail = (n, by, method, sym) => repoTail(n, by, { cache, table: "vault_pages", method, sym });

export default {
  id: "notes", name: "Notes", blurb: "Markdown notes, links and backlinks.",
  intro: "Write in plain Markdown and link notes together. Each link shows up on the other note too.",
  stages: [
    { name: "Write", journeys: ["create-note", "edit-note"] },
    { name: "Connect", journeys: ["link-notes"] },
  ],
  journeys: [
    {
      id: "create-note", name: "Create a note",
      blurb: "Start a blank note in the project vault.",
      outcome: "A new note is in your list, open in Text mode, titled Untitled (or a unique variant).",
      help: { path: "docs/using/notes.md", heading: "Create a note" },
      steps: [
        { title: "Start a note", text: "On the Notes screen, click **New note**.", ui: "New note", hops: [1, 2, 3] },
        { title: "Saved", text: "WeaveForge picks a free title and saves the note straight away.", hops: [4, 5, 6, 7, 8, 9, 10] },
      ],
      chain: [
        { n: 1, layer: "ui", fn: "createUntitled", path: VS, sym: "async function createUntitled() {" },
        { n: 2, by: 1, layer: "bridge", fn: "readyCore().uniqueTitle", path: VS, sym: "readyCore().uniqueTitle(" },
        { n: 3, by: 1, layer: "service", fn: "vault.manageVaultPage.add", path: VS, sym: "getContainer().vault.manageVaultPage.add({" },
        facade(4, 3),
        ...tail(5, 4, "add", "fn add(call: &RepoCall) -> RepoStep {"),
      ],
      debug: [
        { see: "Error banner on the Notes screen after New note, no note appears", check: 3 },
        { see: "Title is a wrong Untitled-N", check: 2 },
      ],
    },
    {
      id: "edit-note", name: "Write in a note",
      blurb: "Type in Text mode; WeaveForge saves as you go.",
      outcome: "Your text is saved and still there after a reload.",
      help: null,
      steps: [
        { title: "Open Text mode", text: "Open a note and pick **Text**.", ui: "Text", hops: [1, 2] },
        { title: "Type", text: "Type in Markdown. Each pause saves the body.", hops: [3, 4, 5, 6, 7, 8, 9, 10] },
      ],
      chain: [
        { n: 1, layer: "ui", fn: "DocumentHost body", path: "apps/web/src/features/editor-workspace/ui/document-host.tsx", sym: "onSave={onSave}" },
        { n: 2, by: 1, layer: "ui", fn: "PageEditor.saveBody", path: PE, sym: "const saveBody = useCallback(" },
        { n: 3, by: 2, layer: "service", fn: "vault.manageVaultPage.update", path: PE, sym: "await vault.manageVaultPage.update(page.id, { body });" },
        facade(4, 3),
        ...tail(5, 4, "update", "fn update(call: &RepoCall) -> RepoStep {"),
      ],
      debug: [
        { see: "Red error line under the body after typing", check: 3 },
        { see: "Edit is gone after a reload", check: 9 },
      ],
    },
    {
      id: "link-notes", name: "Link two notes and see backlinks",
      blurb: "Type [[ to link a note; the other note lists it under Links here.",
      outcome: "Both notes are linked: the link opens the other note, and that note lists yours under Links here.",
      help: { path: "docs/using/notes.md", heading: "Create a note from a link" },
      steps: [
        { title: "Link", text: "Type `[[` and a title, then pick **Create note** if it does not exist yet.", ui: "Create note", hops: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
        { title: "See the backlink", text: "Open the other note. Your note is listed under **Links here**.", ui: "Links here", hops: [13, 14, 15, 16, 17, 18] },
      ],
      chain: [
        { n: 1, layer: "ui", fn: "wikilink autocomplete", path: "apps/web/src/components/markdown/markdown-editor-extensions.ts", sym: "create(title, { open: true });" },
        { n: 2, by: 1, layer: "ui", fn: "DocumentHost createRef", path: "apps/web/src/features/editor-workspace/ui/document-host.tsx", sym: "createRef.current = onCreateNote;" },
        { n: 3, by: 2, layer: "ui", fn: "createNoteFromLink (screen)", path: VS, sym: "const createNoteFromLink = useCallback(" },
        { n: 4, by: 3, layer: "service", fn: "createNoteFromLink", path: PARTS, sym: "export async function createNoteFromLink(" },
        { n: 5, by: 4, layer: "service", fn: "deps.add", path: VS, sym: "add: (t) => getContainer().vault.manageVaultPage.add(" },
        facade(6, 5),
        ...tail(7, 6, "add", "fn add(call: &RepoCall) -> RepoStep {"),
        { n: 13, layer: "ui", fn: "backlinks useMemo", path: VS, sym: "const backlinks = useMemo(" },
        { n: 14, by: 13, layer: "service", fn: "noteBacklinks", path: PARTS, sym: "export function noteBacklinks(" },
        { n: 15, by: 14, layer: "bridge", fn: "readyCore().noteBacklinks", path: PARTS, sym: "readyCore().noteBacklinks(" },
        { n: 16, by: 15, layer: "bridge", fn: "note_backlinks_js (wasm)", path: "crates/wf-wasm/src/vault_page.rs", sym: "pub fn note_backlinks_js(" },
        { n: 17, by: 16, layer: "core", fn: "vault::page::note_backlinks", path: "crates/wf-core/src/vault/page.rs", sym: "pub fn note_backlinks(" },
        { n: 18, by: 13, layer: "ui", fn: "PageEditor Links here", path: PE, sym: "<RecordSection label=\"Links here\"" },
      ],
      debug: [
        { see: "Link stays dashed after Create note", check: 11 },
        { see: "Links here stays empty", check: 17 },
      ],
    },
  ],
};
