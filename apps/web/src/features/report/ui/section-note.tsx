"use client";

import { InlineError } from "@/components/form-error";
import { useEffect, useMemo, useRef, useState } from "react";
import { REPORT_STATUSES, type ReportSection, type ReportStatus } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Select } from "@/components/select";
import { MarkdownCodeEditor } from "@/components/markdown/markdown-code-editor-lazy";
import { editorImageUpload } from "@/lib/editor-image-upload";
import { EditIcon } from "@/components/view-icons";
import { CardMenu } from "@/components/card-menu";
import { ShareButton, CommentsToggle, PinnedPaperBadge } from "@/features/sharing";
import type { EditorHandle } from "@/components/editor-handle";
import { AttachImageButton } from "@/components/attach-image-button";
import { formatError } from "@/lib/format-error";
import { useCiteLinkCatalog } from "@/lib/hooks/use-cite-links";
import { CitationFormatSelect } from "@/components/citation-format-select";
import { useCitationFormatPreference } from "@/lib/hooks/use-citation-format-preference";
import {
  materializeReportBlobImages,
  reportImageMarkdown,
} from "../lib/report-images-md";
import { ReportSectionMarkdown } from "./report-section-markdown";
import { SectionRelatedExcerpts } from "./section-related-excerpts";
import { ExperimentArtifactPicker } from "./experiment-artifact-picker";

/**
 * Full-page section writing view: back, status and word progress, one
 * toolbar (edit, comments, share, more), then read or edit the draft.
 */
export function SectionNote({
  section,
  readOnly = false,
  sharedByName,
  sharedContent = false,
  canComment = false,
  onBack,
  onReplace,
  onChanged,
}: {
  section: ReportSection;
  readOnly?: boolean;
  sharedByName?: string;
  /** True for shared/pinned sections — skip viewer-scoped artifact resolve. */
  sharedContent?: boolean;
  canComment?: boolean;
  onBack: () => void;
  onReplace: (s: ReportSection) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.notes ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);
  // Filled in while the editor is on screen, so the button can insert at the caret.
  const editorHandle = useRef<EditorHandle | null>(null);
  const { titles: wikilinkTitles, completions: wikilinkCompletions } = useCiteLinkCatalog();
  const [citationFormat, setCitationFormat] = useCitationFormatPreference();

  useEffect(() => {
    setEditing(false);
    setDraft(section.notes ?? "");
    setSaveError(null);
    // Resets on section *identity* only. `section.notes` is deliberately not a
    // dep — including it would drop the user out of edit mode on every
    // save/refetch; the effect below owns note-content sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.id]);

  useEffect(() => {
    if (!editing) setDraft(section.notes ?? "");
  }, [section.notes, editing]);

  const dirty = draft !== (section.notes ?? "");
  const hasNotes = Boolean(section.notes?.trim());
  const meta = [
    section.targetWords
      ? `${section.wordCount} / ${section.targetWords} words`
      : `${section.wordCount} words`,
    section.deadline ? `due ${section.deadline}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const progress = section.targetWords
    ? Math.min(100, Math.round((section.wordCount / section.targetWords) * 100))
    : null;

  async function changeStatus(status: ReportStatus) {
    setBusy(true);
    try {
      onReplace(await getContainer().report.manageReportSection.setStatus(section.id, status));
    } finally {
      setBusy(false);
    }
  }

  async function saveNotes() {
    setBusy(true);
    setSaveError(null);
    try {
      const report = getContainer().report;
      const body = await materializeReportBlobImages(draft, section.id, (id, blob, ext) =>
        report.uploadImage(id, blob, ext),
      );
      const updated = await report.manageReportSection.setNotes(section.id, body);
      onReplace(updated);
      setDraft(updated.notes ?? body);
      setEditing(false);
    } catch (err) {
      setSaveError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  /** Accepting a pasted image. Stored against the section, referenced as `reportimg:`. */
  const imagePaste = useMemo(
    () =>
      editorImageUpload({
        store: (blob, ext) => getContainer().report.uploadImage(section.id, blob, ext),
        toMarkdown: reportImageMarkdown,
        onError: setSaveError,
      }),
    [section.id],
  );

  async function remove() {
    if (!confirm(`Delete "${section.title}"?`)) return;
    setBusy(true);
    try {
      await getContainer().report.removeSection(section);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="paper-note">
      <button type="button" className="btn-secondary paper-back" onClick={onBack}>
        ← Report
      </button>

      {/* Status, then one toolbar, then the title: the order of the phone mock
          (PhoneSectionDetail), which reads the same on a wide screen. Delete is
          behind the ⋯ menu, not one stray tap beside Share. */}
      <div className="section-note-status">
        <div className="section-note-status-row">
          {readOnly ? (
            <PinnedPaperBadge ownerName={sharedByName} />
          ) : (
            <span className="paper-note-status">
              <Select
                className="status-select"
                value={section.status}
                disabled={busy}
                onChange={(e) => void changeStatus(e.target.value as ReportStatus)}
                aria-label="Section status"
              >
                {REPORT_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st.replace("_", " ")}
                  </option>
                ))}
              </Select>
            </span>
          )}
          {meta && <span className="muted section-note-meta">{meta}</span>}
        </div>
        {progress !== null && (
          <div className="progress-bar section-note-progress" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>

      <div className="paper-note-head section-note-toolbar" role="toolbar" aria-label="Section">
        {!readOnly && !editing && (
          <button
            type="button"
            className="btn-primary section-note-edit"
            onClick={() => {
              setDraft(section.notes ?? "");
              setEditing(true);
            }}
          >
            <EditIcon />
            {hasNotes ? "Edit" : "Write"}
          </button>
        )}
        {!readOnly && editing && (
          <AttachImageButton editor={editorHandle} onError={setSaveError} disabled={busy} />
        )}
        <CommentsToggle
          resourceType="report_section"
          resourceId={section.id}
          canComment={readOnly ? canComment : true}
          variant="detail"
        />
        {!readOnly && (
          <div className="card-foot-right">
            <ShareButton
              resourceType="report_section"
              resourceId={section.id}
              title={`Share: ${section.title}`}
            />
            <CardMenu
              label="More section actions"
              items={[
                {
                  id: "delete",
                  label: "Delete section",
                  danger: true,
                  disabled: busy,
                  onSelect: () => void remove(),
                },
              ]}
            />
          </div>
        )}
      </div>

      <h1 className="paper-article-title">
        {section.sectionNo && <span className="muted">{section.sectionNo} </span>}
        {section.title}
      </h1>

      <div className="section-note-layout">
      <div className="paper-note-body">
        {!editing ? (
          hasNotes ? (
            <ReportSectionMarkdown
              body={section.notes!}
              className="summary"
              skipArtifactResolve={sharedContent}
            />
          ) : (
            <p className="muted summary-empty">
              {readOnly ? "No note yet." : "No note yet — use “Write note” to start."}
            </p>
          )
        ) : (
          <div className="summary-editor">
            <div className="summary-editor-bar">
              <CitationFormatSelect
                value={citationFormat}
                onChange={setCitationFormat}
                disabled={busy}
              />
              <ExperimentArtifactPicker
                disabled={busy}
                onInsert={(snippet) => {
                  setDraft((prev) => `${prev.trimEnd()}\n\n${snippet}\n`);
                  setSaveError(null);
                }}
              />
            </div>
            <MarkdownCodeEditor
              className="summary-input markdown-code-editor--notes"
              value={draft}
              placeholder="Write this section… Cite with [[ or @. Math: $E = mc^2$."
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
              <button
                type="button"
                className="link-btn"
                onClick={() => setEditing(false)}
                disabled={busy}
              >
                cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void saveNotes()}
                disabled={busy || !dirty}
              >
                {busy ? "Saving…" : "Save note"}
              </button>
            </div>
          </div>
        )}
      </div>
      {!readOnly && (
        <SectionRelatedExcerpts
          section={section}
          onInsert={(snippet) => {
            setDraft((prev) => `${prev.trimEnd()}\n\n${snippet}`);
            setEditing(true);
          }}
        />
      )}
      </div>
    </div>
  );
}
