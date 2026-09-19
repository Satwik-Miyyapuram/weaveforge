"use client";

/**
 * The one place that decides what a document kind *is* on screen.
 *
 * `CollabBodyHost` — the shipped CodeMirror source editor with its Yjs binding —
 * is untouched and stays the renderer for every text kind. It is wrapped here,
 * never replaced, so the collaborative stack, its save policy and its lazy
 * loading boundary are exactly what they were.
 *
 * Read mode is each kind's own renderer — `VaultMarkdown` for a note, the
 * paper and report screens' for theirs — reused rather than rewritten, which
 * is what keeps this from being a third editor surface: there is no live
 * preview, no WYSIWYG, no click-to-edit at the caret. Read is read-only (a
 * picture's width is the one thing it writes), and a wikilink click opens a
 * tab.
 *
 * The per-kind decision is `documentKind(kind)` from `kind.ts`. Ink (`.ink.md`)
 * is one more row there and one more case here when it lands.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { isInkNoteBody, vaultImageMarkdown } from "@weaveforge/core";

import { getContainer } from "@/bootstrap";
import type { EditorHandleRef } from "@/components/editor-handle";
import type { ImagePasteConfig } from "@/components/markdown/markdown-image-paste";
import { CollabBodyHost } from "@/features/collab";
// The features' public APIs, not their `ui/` folders: a feature may reach a
// sibling only through its index (CONTRIBUTING.md § SOLID). A paper's
// `paperimg:` and a section's `reportimg:` resolve here because the resolvers
// are theirs, not because this screen learned the prefixes.
import { InkHost, InkReader } from "@/features/ink";
import { PaperMarkdown, paperImageMarkdown } from "@/features/papers";
import { PaperPdfPane } from "@/features/reader";
import { ReportSectionMarkdown, reportImageMarkdown } from "@/features/report";
import { VaultMarkdown, type WikilinkEntry } from "@/features/vault";
import { editorImageUpload } from "@/lib/editor-image-upload";
import type { CiteCompletion } from "@/lib/hooks/use-cite-links";
import type { DocumentMode, TabRef } from "../application/pane-tree";
import { ImageSizeControl } from "./image-size-control";
import { documentKind, hasInkView, hasPdfView } from "./kind";
import { LivePreview, useMdPreviewMode } from "./md-live-preview";

/** What the active renderer tells the pane about itself. */
export interface DocumentMetrics {
  text?: string;
  cursor?: { line: number; col: number };
}

export interface DocumentLinks {
  notes: WikilinkEntry[];
  papers: WikilinkEntry[];
  sections: WikilinkEntry[];
}

export interface DocumentHostProps {
  tab: TabRef;
  mode: DocumentMode;
  body: string;
  /** Where a read-mode wikilink can go. The same lists `/notes` passes. */
  links?: DocumentLinks;
  /** `[[` and `@` completions — the same catalogue `/notes` offers. */
  completions?: CiteCompletion[];
  /** `#tag` completions: every tag the project already uses. */
  tags?: readonly string[];
  onSave: (body: string) => Promise<void>;
  /** The renderer reporting on itself — see `DocumentMetrics`. */
  onMetrics?: (metrics: DocumentMetrics) => void;
  /**
   * Read mode: a wikilink that resolves opens the document it names as a tab
   * rather than leaving for that document's own screen.
   */
  onOpenLink?: (tab: TabRef) => void;
  /**
   * A `[[title]]` that names no note. Read mode calls it for a click on an
   * unresolved link; Edit mode for the "Create note" completion row and for a
   * link typed and left behind (`open: false` — the person is still writing).
   * Absent when the person has turned creation off in settings.
   */
  onCreateNote?: (title: string, opts?: { open?: boolean }) => void;
  /** Where the pane's toolbar reaches the editor, for the image button. */
  handleRef?: EditorHandleRef;
  /** Where an upload failure is shown. */
  onError?: (message: string | null) => void;
}

/** 1-based `Ln`/`Col` for a character offset, without importing CodeMirror values. */
export function cursorAt(view: EditorView): { line: number; col: number } {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  return { line: line.number, col: head - line.from + 1 };
}

/** Which of the renderers a (kind, mode) pair means. */
export type RendererName = "editor" | "markdown" | "ink" | "pdf" | "pdf_ink" | "ink_reader";

/**
 * The whole decision, as data.
 *
 * Pulled out of the component so it is testable without a DOM: this is the
 * switch the design's §3.3 table describes, and it is the only place in the
 * screen that knows a kind and a mode can interact.
 *
 * `body` is what makes Read mode honest for a note that carries ink. One note
 * kind holds both — you type in Edit, you draw over it in Ink — so its Read
 * mode is the *same sheet* with the pen put down, not the markdown view. Asking
 * `documentKind` alone answered "text" for every note, so Read dropped the
 * strokes, the figures and the diagrams and showed prose only, which is a
 * different document from the one Ink was drawing on.
 */
export function rendererFor(kind: string, mode: DocumentMode, body = ""): RendererName {
  // Ink on a paper is the PDF with the pen rail up — same reader, same
  // annotations, not a separate canvas.
  if (mode === "ink") {
    return hasInkView(kind) ? "ink" : hasPdfView(kind) ? "pdf_ink" : "editor";
  }
  // Only a PDF row has a PDF, and it has nothing else: every other mode on it
  // is the reader. The mode on any other kind means Edit.
  if (mode === "pdf" || documentKind(kind) === "pdf") return hasPdfView(kind) ? "pdf" : "editor";
  if (mode === "read") {
    // A note written in ink is read as the sheet it was written on. A note
    // with no ink in it stays prose, which is what it is.
    return documentKind(kind) === "ink" || (hasInkView(kind) && isInkNoteBody(body))
      ? "ink_reader"
      : "markdown";
  }
  return "editor";
}

/** Whether Edit / Read applies to a kind. */
export function supportsEditMode(kind: string): boolean {
  return documentKind(kind) === "text" || hasInkView(kind);
}

type ImageStore = Pick<Parameters<typeof editorImageUpload>[0], "store" | "toMarkdown">;

/**
 * How each kind stores a pasted or dropped image, and the markdown it writes.
 *
 * The per-kind column `ui/kind.ts` cannot hold, because the values are
 * container calls; but it is the same shape of table, and it is the one an
 * ink note adds a row to. A kind with no row accepts no images.
 */
function imageStore(kind: string, id: string): ImageStore | null {
  switch (kind) {
    case "vault_page":
    case "ink_page":
      return {
        store: (blob, ext) => getContainer().vault.uploadAsset(id, blob, ext),
        toMarkdown: vaultImageMarkdown,
      };
    case "paper":
      return {
        store: (blob, ext) => getContainer().papers.uploadImage(id, blob, ext),
        toMarkdown: paperImageMarkdown,
      };
    case "report_section":
      return {
        store: (blob, ext) => getContainer().report.uploadImage(id, blob, ext),
        toMarkdown: reportImageMarkdown,
      };
    default:
      return null;
  }
}

/** The routes `makeWikilinkResolver` writes, read back as tabs. */
const LINK_ROUTES: Record<string, { param: string; kind: string }> = {
  "/notes": { param: "page", kind: "vault_page" },
  "/papers": { param: "paper", kind: "paper" },
  "/report": { param: "section", kind: "report_section" },
};

export function tabForHref(href: string | null): TabRef | null {
  if (!href) return null;
  const [path, query = ""] = href.split("?");
  const route = LINK_ROUTES[path ?? ""];
  if (!route) return null;
  const id = new URLSearchParams(query).get(route.param);
  return id ? { kind: route.kind, id } : null;
}

export function DocumentHost({
  tab,
  mode,
  body,
  links,
  completions,
  tags,
  onSave,
  onMetrics,
  onOpenLink,
  onCreateNote,
  handleRef,
  onError,
}: DocumentHostProps) {
  // Held in a ref so the editor's `onViewCreated` identity never changes: it is
  // a dependency of the CodeMirror stack, and rebuilding that stack would throw
  // away the document and its undo history.
  const metricsRef = useRef(onMetrics);
  metricsRef.current = onMetrics;
  // The same for the error sink and the create handler: the editing description
  // below is read once, when the stack is built.
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const createRef = useRef(onCreateNote);
  createRef.current = onCreateNote;

  const watch = useCallback((view: EditorView) => {
    const report = () =>
      metricsRef.current?.({ text: view.state.doc.toString(), cursor: cursorAt(view) });
    report();
    // `input` is CodeMirror's own DOM event for "the document changed", and a
    // selection change arrives as a keyup or a mouseup next to it. Listening on
    // the editor's own element keeps this a reporting seam rather than a
    // CodeMirror value import in the screen's bundle.
    const onInput = () => report();
    view.dom.addEventListener("input", onInput);
    view.dom.addEventListener("keyup", onInput);
    view.dom.addEventListener("mouseup", onInput);
    view.dom.addEventListener("focus", onInput);
    return () => {
      view.dom.removeEventListener("input", onInput);
      view.dom.removeEventListener("keyup", onInput);
      view.dom.removeEventListener("mouseup", onInput);
      view.dom.removeEventListener("focus", onInput);
    };
  }, []);

  // The live text, kept here as well as reported, because the preview below
  // reads it: a preview of the last save is a preview of half a minute ago.
  const [liveBody, setLiveBody] = useState<string | null>(body || null);
  useEffect(() => {
    setLiveBody(body || null);
  }, [body]);
  const metricsAsked = Boolean(onMetrics);
  const liveWatch = useCallback(
    (view: EditorView) => {
      // The metrics report runs only where the pane asked for one; the live
      // text is always kept, because the preview is always one toggle away.
      const inner = metricsAsked ? watch(view) : undefined;
      const onInput = () => setLiveBody(view.state.doc.toString());
      onInput();
      view.dom.addEventListener("input", onInput);
      return () => {
        view.dom.removeEventListener("input", onInput);
        inner?.();
      };
    },
    [metricsAsked, watch],
  );
  const [previewMode, choosePreview] = useMdPreviewMode();

  const imagePaste = useMemo<ImagePasteConfig | undefined>(() => {
    const store = imageStore(tab.kind, tab.id);
    if (!store) return undefined;
    return editorImageUpload({ ...store, onError: (message) => errorRef.current?.(message) });
  }, [tab.kind, tab.id]);

  const canCreate = Boolean(onCreateNote);
  const markdownEditing = useMemo(
    () => ({
      placeholder: "Write… [[links]], #tags and @cites complete as you type.",
      wikilinkCompletions: completions,
      tags,
      imagePaste,
      onCreateNote: canCreate
        ? (title: string, opts?: { open?: boolean }) => createRef.current?.(title, opts)
        : undefined,
    }),
    [completions, tags, imagePaste, canCreate],
  );

  // The renderers' own click handler pushes a route (`/notes?page=…`), which is
  // right on their screens and wrong here, where the target is a tab. Caught
  // in the capture phase, before that handler runs, and only for a link that
  // resolved: an unresolved one carries `data-create` and is theirs.
  const onReadClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onOpenLink) return;
      const anchor = (event.target as HTMLElement).closest("a[data-wikilink]");
      if (!anchor || anchor.hasAttribute("data-create")) return;
      const target = tabForHref(anchor.getAttribute("href"));
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      onOpenLink(target);
    },
    [onOpenLink],
  );

  const renderer = rendererFor(tab.kind, mode, body);

  // The read view's renderer, per kind, shared by Read mode and the live
  // preview so the two never disagree about what a document means (§3.3's
  // table again — one place, one decision per kind). A paper and a section
  // read through their own screen's renderer, which is where their image
  // prefix resolves; a note reads through the vault's, which is the one that
  // takes this screen's link lists and can create a note.
  const renderMarkdown = useCallback(
    (text: string) =>
      tab.kind === "paper" ? (
        <PaperMarkdown body={text} className="document-read-body" />
      ) : tab.kind === "report_section" ? (
        <ReportSectionMarkdown body={text} className="document-read-body" />
      ) : (
        <VaultMarkdown
          body={text}
          className="document-read-body"
          notes={links?.notes ?? []}
          papers={links?.papers ?? []}
          sections={links?.sections ?? []}
          onCreateNote={onCreateNote}
        />
      ),
    [tab.kind, links, onCreateNote],
  );

  // A paper's own Notes tab is also an ink sheet (§paper), and its images are
  // `paperimg:` blobs behind the papers facade, so the sheet is told which
  // paper it belongs to. For any other note the id is the note's own and means
  // nothing to a paper lookup, so it is not passed.
  const sheetPaperId = tab.kind === "paper" ? tab.id : null;

  if (renderer === "ink") {
    // The one case §3.3 reserved, and the only place this screen mentions ink.
    //
    // The sidecar is not loaded here: this component is handed a body and a save
    // callback by the pane, and an ink note's strokes live beside the note rather
    // than in it (§4.6). `InkHost` therefore starts on the text layer the body
    // already holds and asks the container's ink facade for its pages itself,
    // which keeps the reading of `.ink/<id>/` in the feature that owns the format.
    return (
      <InkHost
        noteId={tab.id}
        body={body}
        deps={getContainer().ink}
        onSave={onSave}
        paperId={sheetPaperId}
      />
    );
  }

  if (renderer === "ink_reader") {
    // Read mode of an ink note: the same sheet as Ink with the pen down, so
    // everything drawn on it — strokes, figures, diagrams, images — is there
    // to read. It takes no `onSave`: there is nothing to edit.
    return (
      <InkReader noteId={tab.id} body={body} deps={getContainer().ink} paperId={sheetPaperId} />
    );
  }

  if (renderer === "pdf" || renderer === "pdf_ink") {
    // The reader's paper half, in the tab. The route is the same component
    // with a header around it; the PDF is not loaded twice.
    return <PaperPdfPane paperId={tab.id} inkRail={renderer === "pdf_ink"} />;
  }

  if (renderer === "markdown") {
    return (
      <div className="document-read" onClickCapture={onReadClick}>
        <ImageSizeControl body={body} onSave={onSave}>
          {renderMarkdown(body)}
        </ImageSizeControl>
      </div>
    );
  }

  return (
    <LivePreview
      mode={previewMode}
      onModeChange={choosePreview}
      liveBody={liveBody}
      savedBody={body}
      // The live preview is a read view too: a wikilink clicked there opens
      // the target's tab, not the vault route the renderer would push.
      preview={(text) => (
        <div className="md-live-read" onClickCapture={onReadClick}>
          {renderMarkdown(text)}
        </div>
      )}
    >
      <CollabBodyHost
        resourceType={tab.kind}
        resourceId={tab.id}
        initialBody={body}
        onSave={onSave}
        markdownEditing={markdownEditing}
        editorClassName="workspace-editor"
        onViewCreated={liveWatch}
        handleRef={handleRef}
      />
    </LivePreview>
  );
}
