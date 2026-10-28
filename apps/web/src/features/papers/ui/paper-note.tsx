"use client";

import { InlineError } from "@/components/form-error";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PAPER_STATUSES, isEmptyPaperSummary, isInkNoteBody, titleFromFileName, type Paper, type PaperStatus } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { removePaper } from "./remove-paper";
import { describeRejection, formatError } from "@/lib/format-error";
import { logToApp } from "@/lib/error-report/app-log";
import { BellIcon, BellOffIcon, CommentsIcon, DeleteIcon, OpenIcon } from "@/components/view-icons";
import { WORKSPACE_PATH } from "@/lib/hooks/use-workspace-route";
import {
  RecordActivity,
  RecordEmpty,
  RecordFacts,
  RecordSection,
  recordDate,
  wordCount,
} from "@/components/record";
import { RelatedPanel } from "@/components/related-panel";
import { NoteComments, ShareButton, PinnedPaperBadge } from "@/features/sharing";
import { materializePaperBlobImages } from "../lib/paper-images-md";
import { reconcileTagsFromBodyOrDefer } from "../lib/note-tags";
import type { EditorHandle } from "@/components/editor-handle";
import { AttachImageButton } from "@/components/attach-image-button";
import { BackButton } from "@/components/back-button";
import { DocumentBody } from "@/components/document-body";
import { DocumentModeSwitch } from "@/components/document-mode-switch";
import { InkFocusButton, InkFocusExit, useInkFocus } from "@/components/ink-focus";
import { useCiteLinkCatalog } from "@/lib/hooks/use-cite-links";
import { CitationFormatSelect } from "@/components/citation-format-select";
import { useCitationFormatPreference } from "@/lib/hooks/use-citation-format-preference";
import { formatPaperCitation, resolveCiteKey } from "@/features/overleaf/application/build-overleaf-export";
import { PaperExternalLink } from "./paper-external-link";
import { buildLocusLink, resolvePaperPdfUrl } from "@/features/reader";
import { reRenderPaperSourceNote } from "../application/paper-source-note-scaffold";
import { PaperAnnotations } from "./paper-annotations";
import { PaperFieldsStrip } from "./paper-fields";
import { PaperFirstPage, usePaperPreview } from "./paper-first-page";
import { previewReaderHref } from "../application/paper-preview";
import { StatusSelect, statusLabel } from "@/components/status-select";
import { PaperIdentifiersEditor } from "./paper-identifiers-editor";
import { RelatedPapersPanel } from "./related-papers-panel";
import { TagEditor } from "./tag-editor";
import { Modal, ModalActions } from "@/components/modal";
import { Button, IconButton, IconLink } from "@/components/button";
import { RowButton } from "@/components/controls";

/** The modes the switch offers, as the Editor's toolbar does. */
const NOTE_MODES = ["edit", "ink"] as const;
/** Read is what a reader without edit rights sees; the switch never offers it. */
type NoteMode = (typeof NOTE_MODES)[number] | "read";

function QuoteIcon() {
  return (
    <svg className="vicon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 7h4v4c0 3-1.5 5-4 6" />
      <path d="M14 7h4v4c0 3-1.5 5-4 6" />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg className="vicon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

/**
 * One paper as a record page: the title and its catalogue line, a reading
 * column (note, annotations, abstract, fields, links, comments) and a column
 * of facts beside it (first page, record, related by similarity, activity).
 */
export function PaperNote({
  paper,
  readOnly = false,
  sharedByName,
  canComment = false,
  onBack,
  onReplace,
  onChanged,
  onDeleted = onChanged,
}: {
  paper: Paper;
  readOnly?: boolean;
  sharedByName?: string;
  canComment?: boolean;
  onBack: () => void;
  onReplace: (p: Paper) => void;
  onChanged: () => void;
  /** After the delete commits, when the Undo toast closes. Defaults to `onChanged`. */
  onDeleted?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // Text or Ink, as in the Editor's toolbar: a handwritten note opens on its
  // sheet, any other in Text. Only a reader without edit rights reads.
  const [mode, setMode] = useState<NoteMode>(() =>
    readOnly ? "read" : isInkNoteBody(paper.summary ?? "") ? "ink" : "edit",
  );
  const inkFocus = useInkFocus(mode === "ink");
  const modeRef = useRef<NoteMode>(mode);
  modeRef.current = mode;
  const editing = mode !== "read";
  /** The body last written from Edit or Ink, reconciled into tags once put away. */
  const pendingTagsRef = useRef<string | null>(null);
  /** Set once the page has closed: a save that lands after that settles its tags at once. */
  const closedRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [trackingCitations, setTrackingCitations] = useState<boolean | null>(null);
  const [trackingBusy, setTrackingBusy] = useState(false);
  /** The APPEND / REPLACE choice, when a note has no template markers. */
  const [templateChoiceOpen, setTemplateChoiceOpen] = useState(false);
  const [editingIds, setEditingIds] = useState(false);
  const [copied, setCopied] = useState(false);
  // Filled in while the editor is on screen, so the button can insert at the caret.
  const editorHandle = useRef<EditorHandle | null>(null);
  const noteTextRef = useRef<HTMLDivElement>(null);
  const { completions } = useCiteLinkCatalog();
  const [citationFormat, setCitationFormat] = useCitationFormatPreference();

  useEffect(() => {
    let cancelled = false;
    setTrackingCitations(null);
    void getContainer().papers.isCitationTracking(paper.id).then((enabled) => {
      if (!cancelled) setTrackingCitations(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, [paper.id]);
  const hasSummary = !isEmptyPaperSummary(paper.summary);
  const canTrackCitations = Boolean(paper.doi || paper.arxivId);
  const preview = usePaperPreview(paper.id);
  const remoteReaderHref = useMemo(() => {
    const pdfUrl = resolvePaperPdfUrl({
      url: paper.url,
      arxivId: paper.arxivId,
      pdfPath: paper.pdfPath,
      openAccessPdf:
        typeof paper.metadata?.["openAccessPdf"] === "string" ? paper.metadata["openAccessPdf"] : null,
    });
    return pdfUrl ? buildLocusLink({ paperId: paper.id }) : null;
  }, [paper.id, paper.url, paper.arxivId, paper.pdfPath, paper.metadata]);
  // A PDF added from disk or a saved web page has no web link, but the reader opens it.
  const readerHref = previewReaderHref(remoteReaderHref, preview, buildLocusLink({ paperId: paper.id }));

  async function changeStatus(status: PaperStatus) {
    setBusy(true);
    try { onReplace(await getContainer().papers.updatePaper.setStatus(paper.id, status)); }
    finally { setBusy(false); }
  }

  /** Tags are derived solely from the note body's #hashtags. */
  const reconcileTags = useCallback(
    async (body: string, saved?: Paper) => {
      const papers = getContainer().papers;
      // Offline, the tags wait for the connection; the saved paper stands in.
      const next = (await reconcileTagsFromBodyOrDefer(papers, paper.id, body)) ?? saved;
      if (next) onReplace(next);
    },
    [onReplace, paper.id],
  );

  /**
   * Every body write, from any mode — the host saves as it goes, the way it
   * does in the Editor. The tags follow from Read at once, and from Edit or
   * Ink once the surface is put away: a new paper arriving mid-edit would
   * rebuild the surface under the writer.
   */
  const saveBody = useCallback(
    async (nextBody: string) => {
      setSaveError(null);
      try {
        const papers = getContainer().papers;
        const { body, uploadError } = await materializePaperBlobImages(nextBody, paper.id, (id, blob, ext) =>
          papers.uploadImage(id, blob, ext),
        );
        const saved = await papers.updatePaper.setSummary(paper.id, body);
        if (modeRef.current === "read" || closedRef.current) await reconcileTags(body, saved);
        else pendingTagsRef.current = body;
        // The text is saved; a failed upload is still said out loud.
        if (uploadError) throw uploadError;
      } catch (err) {
        setSaveError(formatError(err));
      }
    },
    [paper.id, reconcileTags],
  );

  // Closing the page mid-edit (Back, another paper) settles the tags too, or a
  // #hashtag written in Edit or Ink would never reach the paper. A ref, so the
  // cleanup runs on close only, not whenever `onReplace` changes identity.
  const reconcileTagsRef = useRef(reconcileTags);
  reconcileTagsRef.current = reconcileTags;
  useEffect(
    () => () => {
      closedRef.current = true;
      const pending = pendingTagsRef.current;
      pendingTagsRef.current = null;
      if (pending !== null) {
        // The page is gone, so there is nowhere to show the error: log it.
        void reconcileTagsRef.current(pending).catch((err) =>
          logToApp({ level: "warn", source: "tags", message: "Could not update the note's tags on close", detail: describeRejection(err) }),
        );
      }
    },
    [],
  );

  /** The switch in the section head. Leaving Edit or Ink settles the tags. */
  function chooseMode(next: NoteMode) {
    if (next === mode) return;
    setSaveError(null);
    const pending = pendingTagsRef.current;
    pendingTagsRef.current = null;
    if (pending !== null) void reconcileTags(pending).catch((err) => setSaveError(formatError(err)));
    setMode(next);
  }

  /** Explicit re-render of the source-note template — never silent on load (C1). */
  function reRenderTemplate() {
    const draft = editorHandle.current?.text() ?? paper.summary ?? "";
    const hasMarkers = /<!--\s*\/?wf:(generated|editable):/.test(draft);
    if (!hasMarkers && draft.trim()) {
      // A three-way decision, asked as two buttons. It used to be a
      // `window.prompt` that required the user to *type* the word APPEND or
      // REPLACE into a single-line OS text box — the least discoverable
      // interaction in the product, and a system dialog that ignores the theme
      // and covers the page on a phone.
      setTemplateChoiceOpen(true);
      return;
    }
    applyTemplate(draft);
  }

  /** Write the re-rendered template over (`base === ""`) or under the draft. */
  function applyTemplate(base: string) {
    const next = reRenderPaperSourceNote(base, {
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      venue: paper.venue,
      doi: paper.doi,
      citeKey: resolveCiteKey(paper),
    });
    editorHandle.current?.replaceAll(next);
    setSaveError(null);
    setTemplateChoiceOpen(false);
  }

  const remove = () => removePaper(paper, { onHidden: onBack, onDeleted });

  async function toggleCitationTracking() {
    if (!canTrackCitations || trackingCitations == null) return;
    setTrackingBusy(true);
    setSaveError(null);
    try {
      const updated = await getContainer().papers.setCitationTracking(
        paper.id,
        !trackingCitations,
      );
      setTrackingCitations(!trackingCitations);
      onReplace(updated);
    } catch (err) {
      setSaveError(formatError(err));
    } finally {
      setTrackingBusy(false);
    }
  }

  async function copyCitation() {
    const text =
      citationFormat === "wikilink" ? `[[${paper.title}]]` : formatPaperCitation(paper, citationFormat);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      setSaveError(`The clipboard is not available here: ${formatError(err)}`);
    }
  }

  const citeKey = typeof paper.metadata?.["citeKey"] === "string" ? paper.metadata["citeKey"] : "";
  const fileName = typeof paper.metadata?.["fileName"] === "string" ? paper.metadata["fileName"] : null;
  const words = wordCount(paper.summary);
  const wordsLabel = `${words} ${words === 1 ? "word" : "words"}`;
  const annotationCount = Array.isArray(paper.metadata?.["annotations"])
    ? (paper.metadata["annotations"] as unknown[]).length
    : 0;
  const meta = [
    paper.year ? String(paper.year) : null,
    paper.venue,
    paper.arxivId ? `arXiv:${paper.arxivId}` : null,
    paper.doi ? `DOI ${paper.doi}` : null,
    `Added ${recordDate(paper.createdAt)}`,
  ].filter(Boolean);
  const activity = [
    trackingCitations ? { at: "Now", what: "Citation alerts on" } : null,
    paper.readAt ? { at: recordDate(paper.readAt), what: `Marked ${statusLabel(paper.status).toLowerCase()}` } : null,
    paper.updatedAt && recordDate(paper.updatedAt) !== recordDate(paper.createdAt)
      ? { at: recordDate(paper.updatedAt), what: "Last edited" }
      : null,
    { at: recordDate(paper.createdAt), what: fileName ? `Imported from ${fileName}` : "Added to the library" },
  ].filter((event): event is { at: string; what: string } => event !== null);

  return (
    <article className="record">
      <nav className="record-bar" aria-label="Paper">
        <BackButton label="Papers" onClick={onBack} />
        <span className="record-mono record-bar-id">Record {citeKey || paper.id.slice(0, 6)}</span>
        {readOnly && <PinnedPaperBadge ownerName={sharedByName} />}
        <StatusSelect value={paper.status} statuses={PAPER_STATUSES} disabled={readOnly || busy} onChange={(st) => void changeStatus(st)} label="Reading status" />
        <div className="record-actions">
          {!readOnly && (
            // Without an identifier this opens the editor that adds one, rather
            // than sitting disabled with nowhere to go.
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={canTrackCitations ? trackingCitations ?? false : undefined}
              onClick={() => (canTrackCitations ? void toggleCitationTracking() : setEditingIds(true))}
              disabled={trackingCitations == null || trackingBusy}
              title={
                !canTrackCitations
                  ? "Add a DOI or arXiv ID to track citations"
                  : trackingCitations
                    ? "Citation alerts on — click to stop"
                    : "Track new citations"
              }
            >
              {canTrackCitations ? <BellIcon /> : <BellOffIcon />}
              <span>{trackingCitations ? "Watching" : "Watch"}</span>
            </Button>
          )}
          {!readOnly && (
            <Button variant="ghost" size="sm" href={`${WORKSPACE_PATH}?open=${encodeURIComponent(`paper:${paper.id}`)}`}>
              <OpenIcon />
              <span>Open in editor</span>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => void copyCitation()} title={`Copy the citation (${citationFormat})`}>
            <QuoteIcon />
            <span>{copied ? "Copied" : "Cite"}</span>
          </Button>
          {readerHref && (
            <Button variant="ghost" size="sm" href={readerHref} title="Open in reader">
              <PdfIcon />
              <span>{!remoteReaderHref && preview.kind === "page" ? "Web page" : "PDF"}</span>
            </Button>
          )}
          {!readOnly && (
            <ShareButton resourceType="paper" resourceId={paper.id} title={`Share: ${paper.title}`} showLabel />
          )}
          <IconLink label="Comment" href="#record-comments">
            <CommentsIcon />
          </IconLink>
          {!readOnly && (
            <IconButton size="sm" tone="danger" label="Delete paper" tip="Delete" onClick={() => void remove()} disabled={busy}>
              <DeleteIcon />
            </IconButton>
          )}
        </div>
      </nav>

      <header className="record-head">
        <h1 className="record-title">{titleFromFileName(paper.title)}</h1>
        {paper.authors.length > 0 && (
          <p className="record-by">
            {paper.authors.slice(0, 6).join(", ")}
            {paper.authors.length > 6 ? " et al." : ""}
          </p>
        )}
        <p className="record-mono record-meta">{meta.join(" / ")}</p>
        {!readOnly &&
          (editingIds ? (
            <PaperIdentifiersEditor paper={paper} onClose={() => setEditingIds(false)} onReplace={onReplace} />
          ) : (
            // Reachable either way: a paper with no identifier needs one added,
            // and a paper with a wrong one needs it corrected.
            <p className="record-hint">
              {canTrackCitations ? null : "No DOI or arXiv ID yet, so citation alerts can’t watch this paper. "}
              <Button variant="ghost" size="sm" onClick={() => setEditingIds(true)}>
                {canTrackCitations ? "Edit DOI / arXiv ID" : "Add one"}
              </Button>
            </p>
          ))}
      </header>

      <div className="record-grid">
        <div className="record-main">
          <RecordSection
            label="Note"
            tag={
              !readOnly ? (
                <span className="record-mode-tag">
                  {hasSummary && <span>{wordsLabel}</span>}
                  <DocumentModeSwitch modes={NOTE_MODES} mode={mode === "read" ? "edit" : mode} onMode={chooseMode} />
                  {mode === "ink" && <InkFocusButton onClick={inkFocus.toggle} />}
                </span>
              ) : hasSummary ? (
                wordsLabel
              ) : null
            }
          >
            {mode === "read" && !hasSummary ? (
              readOnly ? (
                <RecordEmpty>No note on this paper.</RecordEmpty>
              ) : (
                <RowButton onClick={() => chooseMode("edit")}>
                  <span className="record-note-empty">Write what this paper is for, in your own words. #hashtags place it in the graph.</span>
                </RowButton>
              )
            ) : (
              <div
                ref={noteTextRef}
                className={
                  mode !== "read"
                    ? `record-doc record-doc--${mode}${inkFocus.focus ? " record-ink-focus is-focus" : ""}`
                    : isInkNoteBody(paper.summary ?? "")
                      ? "record-note-read record-note-read--ink"
                      : "record-note-read"
                }
              >
                {inkFocus.focus && <InkFocusExit onClick={inkFocus.toggle} />}
                {mode === "edit" && (
                  <div className="summary-editor-bar">
                    <CitationFormatSelect value={citationFormat} onChange={setCitationFormat} />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={reRenderTemplate}
                      title="Refresh generated metadata; your edits are preserved"
                    >
                      Refresh paper details
                    </Button>
                    <AttachImageButton editor={editorHandle} onError={setSaveError} />
                  </div>
                )}
                {/* The Editor's own document host, as a paper tab mounts it:
                    Edit, Read and Ink here are that code, not a copy of it. */}
                <DocumentBody
                  tab={{ kind: "paper", id: paper.id }}
                  mode={mode}
                  body={paper.summary ?? ""}
                  completions={completions}
                  citationFormat={citationFormat}
                  onSave={readOnly ? async () => undefined : saveBody}
                  handleRef={editorHandle}
                  onError={setSaveError}
                />
              </div>
            )}
            {saveError && <InlineError>{saveError}</InlineError>}
            {!editing && !readOnly && <TagEditor paper={paper} onReplace={onReplace} />}
          </RecordSection>

          {!editing && (
            <>
              <RecordSection label="Annotations" tag={annotationCount > 0 ? String(annotationCount) : "None yet"}>
                {annotationCount > 0 ? (
                  <PaperAnnotations paper={paper} readOnly={readOnly} />
                ) : (
                  <RecordEmpty>
                    Nothing highlighted yet. Select text in the PDF and the highlight lands here with its page number.
                  </RecordEmpty>
                )}
              </RecordSection>

              <RecordSection label="Abstract" tag={paper.abstract ? null : "Unresolved"}>
                {paper.abstract ? (
                  <p className="record-abstract">{paper.abstract}</p>
                ) : (
                  <RecordEmpty>
                    No abstract on file.{" "}
                    {canTrackCitations
                      ? "Resolve the identifier and WeaveForge will pull one in."
                      : "Add a DOI or arXiv ID and WeaveForge can pull one in."}
                  </RecordEmpty>
                )}
              </RecordSection>

              {!readOnly && (
                <RecordSection label="Linked papers" tag="By hand">
                  <RelatedPapersPanel paper={paper} onChanged={onChanged} />
                </RecordSection>
              )}

              <NoteComments
                resourceType="paper"
                resourceId={paper.id}
                canComment={readOnly ? canComment : true}
                isOwner={!readOnly}
                contentRef={noteTextRef}
                contentKey={`${mode}:${paper.summary ?? ""}`}
              />
            </>
          )}
        </div>

        <aside className="record-aside">
          <PaperFirstPage
            preview={preview}
            readerHref={readerHref}
            caption={`First page${fileName ? ` · ${fileName}` : ""}`}
          />
          <RecordSection label="Record">
            <RecordFacts
              rows={[
                ["Status", statusLabel(paper.status)],
                paper.year ? ["Year", String(paper.year)] : null,
                paper.venue ? ["Venue", paper.venue] : null,
                paper.arxivId ? ["arXiv", paper.arxivId] : null,
                paper.doi ? ["DOI", paper.doi] : null,
                citeKey ? ["Cite key", citeKey] : null,
                ["Added", recordDate(paper.createdAt)],
                ["Tags", paper.tags.length > 0 ? paper.tags.map((t) => `#${t}`).join(" ") : "—"],
              ]}
            />
            <PaperExternalLink paper={paper} />
          </RecordSection>
          <RecordSection label="Fields">
            <PaperFieldsStrip paperId={paper.id} readOnly={readOnly} />
          </RecordSection>
          {/* What the graph, the wording and the meaning put next to this
              paper — including things nobody linked by hand. */}
          <RelatedPanel seedKind="paper" seedId={paper.id} variant="record" />
          <RecordSection label="Activity">
            <RecordActivity events={activity} />
          </RecordSection>
        </aside>
      </div>

      {/*
       * The APPEND / REPLACE choice, as two buttons rather than a typed word.
       *
       * The note has no template markers, so re-rendering the source template
       * has to know whether to keep the prose or start from a clean file. Both
       * answers are offered plainly, and the destructive one is coloured for
       * it; neither autofocuses — the modal's focus trap lands on Cancel.
       */}
      {templateChoiceOpen ? (
        <Modal title="Re-render the note template" onClose={() => setTemplateChoiceOpen(false)}>
          <p className="muted confirm-dialog-body">
            This note has no template markers. Add a fresh metadata block above your text, or start
            from a clean template — the latter discards the draft you have now.
          </p>
          <ModalActions>
            <Button variant="cancel"
              onClick={() => setTemplateChoiceOpen(false)}
              autoFocus
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={() => applyTemplate("")}>
              Replace
            </Button>
            <Button variant="primary" onClick={() => applyTemplate(editorHandle.current?.text() ?? paper.summary ?? "")}>
              Append
            </Button>
          </ModalActions>
        </Modal>
      ) : null}
    </article>
  );
}
