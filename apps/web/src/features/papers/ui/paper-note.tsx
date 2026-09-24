"use client";

import { InlineError } from "@/components/form-error";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { titleFromFileName, type Paper, type PaperStatus } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { confirmRemovePaper } from "./remove-paper";
import { formatError } from "@/lib/format-error";
import { BellIcon, BellOffIcon, CommentsIcon, DeleteIcon, EditIcon } from "@/components/view-icons";
import {
  RecordActivity,
  RecordEmpty,
  RecordFacts,
  RecordSection,
  recordDate,
  wordCount,
} from "@/components/record";
import { RelatedPanel } from "@/components/related-panel";
import { ShareButton, PinnedPaperBadge } from "@/features/sharing";
import { CommentsPanel } from "@/features/sharing/ui/comments-panel";
import { PaperMarkdown } from "./paper-markdown";
import { paperImageMarkdown, materializePaperBlobImages } from "../lib/paper-images-md";
import { reconcileTagsFromBody } from "../lib/note-tags";
import type { EditorHandle } from "@/components/editor-handle";
import { AttachImageButton } from "@/components/attach-image-button";
import { MarkdownCodeEditor } from "@/components/markdown/markdown-code-editor-lazy";
import { editorImageUpload } from "@/lib/editor-image-upload";
import { useCiteLinkCatalog } from "@/lib/hooks/use-cite-links";
import { CitationFormatSelect } from "@/components/citation-format-select";
import { useCitationFormatPreference } from "@/lib/hooks/use-citation-format-preference";
import { formatPaperCitation, resolveCiteKey } from "@/features/overleaf/application/build-overleaf-export";
import { PaperExternalLink } from "./paper-external-link";
import { buildLocusLink, resolvePaperPdfUrl } from "@/features/reader";
import { reRenderPaperSourceNote } from "../application/paper-source-note-scaffold";
import { PaperAnnotations } from "./paper-annotations";
import { PaperFieldsStrip } from "./paper-fields";
import { PaperFirstPage } from "./paper-first-page";
import { PaperStatusControl, statusLabel } from "./paper-status";
import { PaperIdentifiersEditor } from "./paper-identifiers-editor";
import { RelatedPapersPanel } from "./related-papers-panel";
import { TagEditor } from "./tag-editor";
import { Modal } from "@/components/modal";

/** How far along reading a paper is, as the dots in the bar. */
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
}: {
  paper: Paper;
  readOnly?: boolean;
  sharedByName?: string;
  canComment?: boolean;
  onBack: () => void;
  onReplace: (p: Paper) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(paper.summary ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [trackingCitations, setTrackingCitations] = useState<boolean | null>(null);
  const [trackingBusy, setTrackingBusy] = useState(false);
  /** The APPEND / REPLACE choice, when a note has no template markers. */
  const [templateChoiceOpen, setTemplateChoiceOpen] = useState(false);
  const [editingIds, setEditingIds] = useState(false);
  const [copied, setCopied] = useState(false);
  // Filled in while the editor is on screen, so the button can insert at the caret.
  const editorHandle = useRef<EditorHandle | null>(null);
  const { titles: wikilinkTitles, completions: wikilinkCompletions } = useCiteLinkCatalog();
  const [citationFormat, setCitationFormat] = useCitationFormatPreference();

  useEffect(() => { if (!editing) setDraft(paper.summary ?? ""); }, [paper.summary, editing]);
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
  const dirty = draft.trim() !== (paper.summary ?? "");
  const hasSummary = !!paper.summary && paper.summary !== "No summary yet.";
  const canTrackCitations = Boolean(paper.doi || paper.arxivId);
  const readerHref = useMemo(() => {
    const pdfUrl = resolvePaperPdfUrl({
      url: paper.url,
      arxivId: paper.arxivId,
      pdfPath: paper.pdfPath,
      openAccessPdf:
        typeof paper.metadata?.["openAccessPdf"] === "string" ? paper.metadata["openAccessPdf"] : null,
    });
    return pdfUrl ? buildLocusLink({ paperId: paper.id }) : null;
  }, [paper.id, paper.url, paper.arxivId, paper.pdfPath, paper.metadata]);

  async function changeStatus(status: PaperStatus) {
    setBusy(true);
    try { onReplace(await getContainer().papers.updatePaper.setStatus(paper.id, status)); }
    finally { setBusy(false); }
  }

  async function saveSummary() {
    setBusy(true);
    setSaveError(null);
    try {
      const papers = getContainer().papers;
      const body = await materializePaperBlobImages(draft, paper.id, (id, blob, ext) =>
        papers.uploadImage(id, blob, ext),
      );
      await papers.updatePaper.setSummary(paper.id, body);
      // Tags are derived solely from the note body's #hashtags.
      onReplace(await reconcileTagsFromBody(papers.manageTags, paper.id, body));
      setEditing(false);
    } catch (err) {
      setSaveError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  /** Accepting a pasted image. Stored against the paper, referenced as `paperimg:`. */
  const imagePaste = useMemo(
    () =>
      editorImageUpload({
        store: (blob, ext) => getContainer().papers.uploadImage(paper.id, blob, ext),
        toMarkdown: paperImageMarkdown,
        onError: setSaveError,
      }),
    [paper.id],
  );

  /** Explicit re-render of the source-note template — never silent on load (C1). */
  function reRenderTemplate() {
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
    setDraft(next);
    setSaveError(null);
    setTemplateChoiceOpen(false);
  }

  const remove = () => confirmRemovePaper(paper, setBusy, onChanged);

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
    } catch {
      setSaveError("The clipboard is not available here.");
    }
  }

  function startEditing() {
    setDraft(paper.summary ?? "");
    setEditing(true);
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
    paper.readAt ? { at: recordDate(paper.readAt), what: `Marked ${statusLabel(paper.status)}` } : null,
    paper.updatedAt && recordDate(paper.updatedAt) !== recordDate(paper.createdAt)
      ? { at: recordDate(paper.updatedAt), what: "Last edited" }
      : null,
    { at: recordDate(paper.createdAt), what: fileName ? `Imported from ${fileName}` : "Added to the library" },
  ].filter((event): event is { at: string; what: string } => event !== null);

  return (
    <article className="record">
      <nav className="record-bar" aria-label="Paper">
        <button type="button" className="record-back" onClick={onBack}>← Papers</button>
        <span className="record-mono record-bar-id">Record {citeKey || paper.id.slice(0, 6)}</span>
        {readOnly ? (
          <PinnedPaperBadge ownerName={sharedByName} />
        ) : (
          <PaperStatusControl status={paper.status} disabled={busy} onChange={(s) => void changeStatus(s)} />
        )}
        <div className="record-actions">
          {!readOnly && (
            // Without an identifier this opens the editor that adds one, rather
            // than sitting disabled with nowhere to go.
            <button
              type="button"
              className={`record-action${trackingCitations ? " is-on" : ""}`}
              onClick={() => (canTrackCitations ? void toggleCitationTracking() : setEditingIds(true))}
              disabled={trackingCitations == null || trackingBusy}
              aria-pressed={canTrackCitations ? trackingCitations ?? false : undefined}
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
            </button>
          )}
          <button
            type="button"
            className="record-action"
            onClick={() => void copyCitation()}
            title={`Copy the citation (${citationFormat})`}
          >
            <QuoteIcon />
            <span>{copied ? "Copied" : "Cite"}</span>
          </button>
          {readerHref && (
            <Link href={readerHref} className="record-action" title="Open in reader">
              <PdfIcon />
              <span>PDF</span>
            </Link>
          )}
          {!readOnly && (
            <ShareButton resourceType="paper" resourceId={paper.id} title={`Share: ${paper.title}`} showLabel />
          )}
          <a href="#record-comments" className="record-action">
            <CommentsIcon />
            <span>Comment</span>
          </a>
          {!readOnly && (
            <button
              type="button"
              className="record-action danger"
              onClick={() => void remove()}
              disabled={busy}
              aria-label="Delete paper"
              title="Delete"
            >
              <DeleteIcon />
            </button>
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
              <button type="button" className="link-btn" onClick={() => setEditingIds(true)}>
                {canTrackCitations ? "Edit DOI / arXiv ID" : "Add one"}
              </button>
            </p>
          ))}
      </header>

      <div className="record-grid">
        <div className="record-main">
          <RecordSection
            label="Note"
            tag={
              !readOnly && !editing ? (
                <button type="button" className="record-tag-btn" onClick={startEditing}>
                  <EditIcon size={13} /> {hasSummary ? wordsLabel : "Write"}
                </button>
              ) : hasSummary ? (
                wordsLabel
              ) : null
            }
          >
            {!editing ? (
              hasSummary ? (
                <PaperMarkdown body={paper.summary!} className="summary record-note" />
              ) : readOnly ? (
                <RecordEmpty>No note on this paper.</RecordEmpty>
              ) : (
                <button type="button" className="record-note-empty" onClick={startEditing}>
                  Write what this paper is for, in your own words. #hashtags place it in the graph.
                </button>
              )
            ) : (
              <div className="summary-editor">
                <div className="summary-editor-bar">
                  <CitationFormatSelect value={citationFormat} onChange={setCitationFormat} disabled={busy} />
                  <button
                    type="button"
                    className="link-btn"
                    onClick={reRenderTemplate}
                    disabled={busy}
                    title="Refresh generated metadata; your edits are preserved"
                  >
                    Re-render template
                  </button>
                  <AttachImageButton editor={editorHandle} onError={setSaveError} disabled={busy} />
                </div>
                <MarkdownCodeEditor
                  className="summary-input markdown-code-editor--notes"
                  value={draft}
                  placeholder="Write your note… Use #hashtags to link this paper in the graph. Math: $E = mc^2$ or $$\\frac{a}{b}$$."
                  disabled={busy}
                  onChange={setDraft}
                  wikilinkTitles={wikilinkTitles}
                  wikilinkCompletions={wikilinkCompletions}
                  citationFormat={citationFormat}
                  imagePaste={imagePaste}
                  handleRef={editorHandle}
                />
                <div className="summary-editor-foot">
                  {saveError && <InlineError>{saveError}</InlineError>}
                  <button type="button" className="link-btn" onClick={() => setEditing(false)} disabled={busy}>cancel</button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => void saveSummary()}
                    disabled={busy || !dirty}
                  >
                    {busy ? "Saving…" : "Save note"}
                  </button>
                </div>
              </div>
            )}
            {!editing && saveError && <InlineError>{saveError}</InlineError>}
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

              <RecordSection label="Fields">
                <PaperFieldsStrip paperId={paper.id} readOnly={readOnly} />
              </RecordSection>

              {!readOnly && (
                <RecordSection label="Linked papers" tag="By hand">
                  <RelatedPapersPanel paper={paper} onChanged={onChanged} />
                </RecordSection>
              )}

              <RecordSection label="Comments" id="record-comments">
                <CommentsPanel resourceType="paper" resourceId={paper.id} canComment={readOnly ? canComment : true} />
              </RecordSection>
            </>
          )}
        </div>

        <aside className="record-aside">
          <PaperFirstPage
            paperId={paper.id}
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
          <div className="confirm-dialog-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setTemplateChoiceOpen(false)}
              autoFocus
            >
              Cancel
            </button>
            <button type="button" className="btn-secondary danger" onClick={() => applyTemplate("")}>
              Replace
            </button>
            <button type="button" className="btn-primary" onClick={() => applyTemplate(draft)}>
              Append
            </button>
          </div>
        </Modal>
      ) : null}
    </article>
  );
}
