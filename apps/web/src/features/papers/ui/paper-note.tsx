"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PAPER_STATUSES, type Paper, type PaperStatus } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { formatError } from "@/lib/format-error";
import { BellIcon, BellOffIcon, DeleteIcon, EditIcon } from "@/components/view-icons";
import { RelatedPanel } from "@/components/related-panel";
import { ShareButton, CommentsToggle, PinnedPaperBadge } from "@/features/sharing";
import { PaperMarkdown } from "./paper-markdown";
import { paperImageMarkdown, materializePaperBlobImages } from "../lib/paper-images-md";
import { reconcileTagsFromBody } from "../lib/note-tags";
import type { EditorHandle } from "@/components/editor-handle";
import { AttachImageButton } from "@/components/attach-image-button";
import { Select } from "@/components/select";
import { MarkdownCodeEditor } from "@/components/markdown/markdown-code-editor-lazy";
import { editorImageUpload } from "@/lib/editor-image-upload";
import { useCiteLinkCatalog } from "@/lib/hooks/use-cite-links";
import { CitationFormatSelect } from "@/components/citation-format-select";
import { useCitationFormatPreference } from "@/lib/hooks/use-citation-format-preference";
import { resolveCiteKey } from "@/features/overleaf/application/build-overleaf-export";
import { PaperExternalLink } from "./paper-external-link";
import { buildLocusLink, resolvePaperPdfUrl } from "@/features/reader";
import { reRenderPaperSourceNote } from "../application/paper-source-note-scaffold";
import { PaperAnnotations } from "./paper-annotations";
import { PaperFieldsStrip } from "./paper-fields";
import { PaperIdentifiersEditor } from "./paper-identifiers-editor";
import { RelatedPapersPanel } from "./related-papers-panel";
import { TagEditor } from "./tag-editor";

/** Full-page reading view for one paper: the note as an article, plus tags,
 *  annotations, figures, and an inline note editor. */
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
  const [editingIds, setEditingIds] = useState(false);
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
    });
    return pdfUrl ? buildLocusLink({ paperId: paper.id }) : null;
  }, [paper.id, paper.url, paper.arxivId, paper.pdfPath]);

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
    const citeKey = resolveCiteKey(paper);
    const hasMarkers = /<!--\s*\/?wf:(generated|editable):/.test(draft);
    if (!hasMarkers && draft.trim()) {
      const choice = window.prompt(
        "This note has no template markers.\n\nType APPEND to keep your text and add a fresh metadata block,\nor REPLACE to start from a clean template (your current draft is discarded).",
        "APPEND",
      );
      if (choice == null) return;
      const normalized = choice.trim().toUpperCase();
      if (normalized === "REPLACE") {
        const next = reRenderPaperSourceNote("", {
          title: paper.title,
          authors: paper.authors,
          year: paper.year,
          venue: paper.venue,
          doi: paper.doi,
          citeKey,
        });
        setDraft(next);
        setSaveError(null);
        return;
      }
      if (normalized !== "APPEND") return;
    }
    const next = reRenderPaperSourceNote(draft, {
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      venue: paper.venue,
      doi: paper.doi,
      citeKey,
    });
    setDraft(next);
    setSaveError(null);
  }

  async function remove() {
    if (!confirm(`Remove "${paper.title}"? This also deletes its list memberships and graph edges.`)) return;
    setBusy(true);
    try {
      await getContainer().papers.deletePaper(paper);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

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

  return (
    <div className="paper-note">
      <button type="button" className="btn-secondary paper-back" onClick={onBack}>← Papers</button>

      <div className="paper-note-head">
        {!readOnly && (
          <button
            type="button"
            className="entity-icon-btn danger"
            onClick={() => void remove()}
            disabled={busy}
            aria-label="Delete paper"
            title="Delete"
          >
            <DeleteIcon />
          </button>
        )}
        {readOnly ? (
          <PinnedPaperBadge ownerName={sharedByName} />
        ) : (
          <span className="paper-note-status">
            <Select
              className="status-select"
              value={paper.status}
              disabled={busy}
              onChange={(e) => void changeStatus(e.target.value as PaperStatus)}
              aria-label="Reading status"
            >
              {PAPER_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </Select>
          </span>
        )}
        <div className="card-foot-right">
          {readOnly ? (
            <CommentsToggle resourceType="paper" resourceId={paper.id} canComment={canComment} variant="detail" />
          ) : (
            <>
              <ShareButton resourceType="paper" resourceId={paper.id} title={`Share: ${paper.title}`} />
              {/* Without an identifier this used to be a disabled button whose
                  tooltip told you to add a DOI — with nowhere to add one. Now it
                  opens the editor that fixes exactly that. */}
              <button
                type="button"
                className={`entity-icon-btn${trackingCitations ? " is-active" : ""}`}
                onClick={() =>
                  canTrackCitations ? void toggleCitationTracking() : setEditingIds(true)
                }
                disabled={trackingCitations == null || trackingBusy}
                aria-pressed={canTrackCitations ? trackingCitations ?? false : undefined}
                aria-label={
                  !canTrackCitations
                    ? "Add a DOI or arXiv ID to track citations"
                    : trackingCitations
                      ? "Stop citation alerts"
                      : "Track new citations"
                }
                title={
                  canTrackCitations
                    ? trackingCitations
                      ? "Citation alerts on"
                      : "Track new citations"
                    : "Add a DOI or arXiv ID to track citations"
                }
              >
                {canTrackCitations ? <BellIcon /> : <BellOffIcon />}
              </button>
              {!editing && (
                <button
                  type="button"
                  className="entity-icon-btn"
                  onClick={() => { setDraft(paper.summary ?? ""); setEditing(true); }}
                  aria-label={hasSummary ? "Edit note" : "Add note"}
                  title={hasSummary ? "Edit note" : "Add note"}
                >
                  <EditIcon />
                </button>
              )}
              {editing && (
                <AttachImageButton editor={editorHandle} onError={setSaveError} disabled={busy} />
              )}
              <CommentsToggle resourceType="paper" resourceId={paper.id} canComment variant="detail" />
            </>
          )}
        </div>
      </div>

      <h1 className="paper-article-title">{paper.title}</h1>
      <div className="paper-source-meta">
        {paper.authors.length > 0 && (
          <p className="muted paper-article-by">
            <strong>{paper.authors.slice(0, 6).join(", ")}{paper.authors.length > 6 ? " et al." : ""}</strong>
            {paper.year ? ` · ${paper.year}` : ""}
          </p>
        )}
        <ul className="paper-source-meta-list muted">
          {paper.venue && <li>Venue: {paper.venue}</li>}
          {paper.doi && <li>DOI: {paper.doi}</li>}
          {paper.arxivId && <li>arXiv: {paper.arxivId}</li>}
          {typeof paper.metadata?.["citeKey"] === "string" && paper.metadata["citeKey"] && (
            <li>Cite key: {String(paper.metadata["citeKey"])}</li>
          )}
        </ul>
        {!readOnly &&
          (editingIds ? (
            <PaperIdentifiersEditor
              paper={paper}
              onClose={() => setEditingIds(false)}
              onReplace={onReplace}
            />
          ) : (
            // Reachable either way: a paper with no identifier needs one added,
            // and a paper with a wrong one needs it corrected.
            <p className="muted paper-source-hint">
              {canTrackCitations
                ? "Citation alerts can watch this paper. "
                : "No DOI or arXiv ID, so citation alerts can’t watch this paper. "}
              <button type="button" className="link-btn" onClick={() => setEditingIds(true)}>
                {canTrackCitations ? "Edit DOI / arXiv ID" : "Add one"}
              </button>
            </p>
          ))}
        <div className="paper-source-actions">
          {readerHref && (
            <Link href={readerHref} className="btn-secondary btn-sm">
              Open in reader
            </Link>
          )}
          <PaperExternalLink paper={paper} />
        </div>
      </div>

      {/* What the graph and wording put next to this paper — including things
          nobody linked by hand. */}
      <RelatedPanel seedKind="paper" seedId={paper.id} />

      <div className="paper-note-body">
        <details className="paper-source-section" open>
          <summary>Note</summary>
        {!editing ? (
          hasSummary
            ? <PaperMarkdown body={paper.summary!} className="summary" />
            : <p className="muted summary-empty">No note yet — use “Add note” to write one.</p>
        ) : (
          <div className="summary-editor">
            <div className="summary-editor-bar">
              <CitationFormatSelect
                value={citationFormat}
                onChange={setCitationFormat}
                disabled={busy}
              />
              <button
                type="button"
                className="link-btn"
                onClick={reRenderTemplate}
                disabled={busy}
                title="Refresh generated metadata; your edits are preserved"
              >
                Re-render template
              </button>
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
              {saveError && <span className="error">{saveError}</span>}
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
        {!editing && !readOnly && <TagEditor paper={paper} onReplace={onReplace} />}
        </details>

        {!editing && (
          <details className="paper-source-section" open>
            <summary>Fields</summary>
            <PaperFieldsStrip paperId={paper.id} readOnly={readOnly} />
          </details>
        )}
        {!editing && (
          <details className="paper-source-section" open>
            <summary>Annotations</summary>
            <PaperAnnotations paper={paper} readOnly={readOnly} />
          </details>
        )}
        {!editing && !readOnly && (
          <details className="paper-source-section">
            <summary>Related papers</summary>
            <RelatedPapersPanel paper={paper} onChanged={onChanged} />
          </details>
        )}
      </div>
    </div>
  );
}
