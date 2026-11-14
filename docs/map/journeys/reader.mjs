import { repoTail, WIRE } from "./tail.mjs";

const R = "apps/web/src/features/reader/ui";
const RA = "apps/web/src/features/reader/application/parts-3.ts";
const PR = "apps/web/src/features/reader/ui/pdf-reader";

export default {
  id: "reader", name: "Reader", blurb: "Read PDFs and annotate them.",
  intro: "Open a paper's PDF, mark what matters, and take quotes with you.",
  stages: [
    { name: "Read", journeys: ["open-pdf"] },
    { name: "Annotate", journeys: ["highlight", "annotation-to-note"] },
  ],
  journeys: [
    {
      id: "open-pdf", name: "Open a paper's PDF",
      blurb: "Open the PDF next to the paper's note.",
      outcome: "The PDF is open in the reader, next to your notes.",
      help: { path: "docs/using/reader.md", heading: "Open a paper's PDF" },
      steps: [
        { title: "Open in reader", text: "On the paper's note, click **Open in reader**.", hops: [1, 2] },
        { title: "The PDF loads", text: "WeaveForge finds the PDF (your file, open access, or the link) and shows it.", hops: [3, 4, 5, 6, 7] },
      ],
      chain: [
        { n: 1, layer: "ui", fn: "PaperNote Open in reader", path: "apps/web/src/features/papers/ui/paper-note.tsx", sym: "title=\"Open in reader\"" },
        { n: 2, by: 1, layer: "ui", fn: "ReaderScreen", path: `${R}/reader-screen.tsx`, sym: "export function ReaderScreen()" },
        { n: 3, by: 2, layer: "ui", fn: "PaperPdfPane", path: `${R}/paper-pdf-pane.tsx`, sym: "export function PaperPdfPane({" },
        { n: 4, by: 3, layer: "service", fn: "resolvePaperPdfSourceForReader", path: RA, sym: "export async function resolvePaperPdfSourceForReader(" },
        { n: 5, by: 4, layer: "service", fn: "resolvePaperPdfSource", path: RA, sym: "export function resolvePaperPdfSource(" },
        { n: 6, by: 4, layer: "network", fn: "fetchPdfBytesForCache", path: RA, sym: "export async function fetchPdfBytesForCache(" },
        { n: 7, by: 3, layer: "ui", fn: "PdfReader", path: `${PR}/pdf-reader.tsx`, sym: "export function PdfReader({" },
      ],
      debug: [
        { see: "Reader says there is no PDF for this paper", check: 4 },
        { see: "Reader stays blank or spins", check: 3 },
      ],
    },
    {
      id: "highlight", name: "Highlight a passage",
      blurb: "Select text in the PDF and highlight it.",
      outcome: "The passage is highlighted and listed in the annotations sidebar.",
      help: { path: "docs/using/reader.md", heading: "Annotate a passage" },
      steps: [
        { title: "Select text", text: "Select a passage in the PDF. A small bar appears.", hops: [1, 2] },
        { title: "Highlight", text: "Click **Highlight** in the bar.", ui: "Highlight", hops: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] },
      ],
      chain: [
        { n: 1, layer: "ui", fn: "PdfReader onSelectionEnd", path: `${PR}/pdf-reader.tsx`, sym: "function onSelectionEnd(" },
        { n: 2, by: 1, layer: "ui", fn: "setPendingCreate", path: `${PR}/pdf-reader.tsx`, sym: "setPendingCreate({" },
        { n: 3, by: 2, layer: "ui", fn: "SelectionCreateBar", path: `${R}/selection-create-bar.tsx`, sym: "onClick={() => onCreate(type, type === \"highlight\"" },
        { n: 4, by: 3, layer: "ui", fn: "PdfReader onCreate", path: `${PR}/pdf-reader.tsx`, sym: "onCreate={(type, color, comment) => {" },
        { n: 5, by: 4, layer: "ui", fn: "createFromPending", path: `${PR}/pdf-reader.tsx`, sym: "async function createFromPending(" },
        { n: 6, by: 5, layer: "bridge", fn: "draftFromTextSelection", path: `${PR}/pdf-reader.tsx`, sym: "draftFromTextSelection(" },
        { n: 7, by: 5, layer: "hook", fn: "useAnnotationActions.persistDraft", path: `${PR}/use-annotation-actions.ts`, sym: "const persistDraft = useCallback(" },
        { n: 8, by: 7, layer: "service", fn: "papers.createReaderAnnotation", path: "apps/web/src/container/facades/papers.ts", sym: "createReaderAnnotation(" },
        ...repoTail(9, 8, {
          cache: { fn: "cacheRepo(readerAnnotationRepository)", path: WIRE, sym: "const readerAnnotationRepository = cacheRepo(" },
          table: "reader_annotations", method: "create", sym: "fn create(call: &RepoCall) -> RepoStep {",
        }),
      ],
      debug: [
        { see: "Highlight flashes and disappears", check: 7 },
        { see: "Highlight gone after a reload", check: 13 },
      ],
    },
    {
      id: "annotation-to-note", name: "Copy a quote with its citation",
      blurb: "Copy an annotation as a quote block with the paper cited, ready to paste into a note.",
      outcome: "Your clipboard holds the quote and its citation; paste it into any note.",
      help: null,
      steps: [
        { title: "Copy", text: "In the annotations sidebar, click **Copy quote + cite** on an annotation.", ui: "Copy quote + cite", hops: [1, 2, 3, 4, 5] },
        { title: "Paste", text: "Paste into a note. The quote keeps its citation.", hops: [6] },
      ],
      chain: [
        { n: 1, layer: "ui", fn: "AnnotationSidebar copy button", path: `${R}/annotation-sidebar.tsx`, sym: "onClick={() => void copyCite(a)}" },
        { n: 2, by: 1, layer: "ui", fn: "copyCite", path: `${R}/annotation-sidebar.tsx`, sym: "async function copyCite(a: ReaderAnnotation) {" },
        { n: 3, by: 2, layer: "bridge", fn: "readyCore().formatQuoteCiteClipboard", path: `${R}/annotation-sidebar.tsx`, sym: "readyCore().formatQuoteCiteClipboard(" },
        { n: 4, by: 3, layer: "bridge", fn: "formatQuoteCiteClipboard (wasm)", path: "crates/wf-wasm/src/papers_quote_block.rs", sym: "js_name = formatQuoteCiteClipboard" },
        { n: 5, by: 4, layer: "core", fn: "papers::quote_block::format_quote_cite_clipboard", path: "crates/wf-core/src/papers/quote_block.rs", sym: "format_quote_cite_clipboard" },
        { n: 6, by: 2, layer: "ui", fn: "navigator.clipboard.writeText", path: `${R}/annotation-sidebar.tsx`, sym: "navigator.clipboard.writeText(" },
      ],
      debug: [
        { see: "Nothing is copied", check: 6 },
        { see: "Citation missing or wrong in the pasted quote", check: 5 },
      ],
    },
  ],
};
