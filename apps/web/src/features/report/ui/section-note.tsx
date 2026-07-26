"use client";

import { useEffect, useRef, useState } from "react";
import { REPORT_STATUSES, type ReportSection, type ReportStatus } from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { Select } from "@/components/select";
import { MarkdownCodeEditor } from "@/components/markdown-code-editor-lazy";
import { DeleteIcon, EditIcon, ImageIcon } from "@/components/view-icons";
import { ShareButton, CommentsToggle, PinnedPaperBadge } from "@/features/sharing";
import { compressImage } from "@/lib/image-compress";
import { formatError } from "@/lib/format-error";
import { useCiteLinkCatalog } from "@/lib/use-cite-links";
import { CitationFormatSelect } from "@/components/citation-format-select";
import { useCitationFormatPreference } from "@/lib/use-citation-format-preference";
import {
  materializeReportBlobImages,
  reportImageMarkdown,
} from "../lib/report-images-md";
import { ReportSectionMarkdown } from "./report-section-markdown";
import { SectionRelatedExcerpts } from "./section-related-excerpts";
import { ExperimentArtifactPicker } from "./experiment-artifact-picker";

/** Plain-text card preview — keeps outline cards compact like papers. */
export function sectionNoteSnippet(body: string, max = 140): string {
  const text = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Note attached";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Full-page section writing view — same chrome as PaperNote: back, status,
 * share/comments, then read or edit the draft.
 */
export function SectionNote({
  section,
  readOnly = false,
  sharedByName,
  canComment = false,
  onBack,
  onReplace,
  onChanged,
}: {
  section: ReportSection;
  readOnly?: boolean;
  sharedByName?: string;
  canComment?: boolean;
  onBack: () => void;
  onReplace: (s: ReportSection) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.notes ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { titles: wikilinkTitles, completions: wikilinkCompletions } = useCiteLinkCatalog();
  const [citationFormat, setCitationFormat] = useCitationFormatPreference();

  useEffect(() => {
    setEditing(false);
    setDraft(section.notes ?? "");
    setSaveError(null);
  }, [section.id]);

  useEffect(() => {
    if (!editing) setDraft(section.notes ?? "");
  }, [section.notes, editing]);

  const dirty = draft !== (section.notes ?? "");
  const hasNotes = Boolean(section.notes?.trim());
  const meta = [
    section.sectionNo ? `§ ${section.sectionNo}` : null,
    section.targetWords
      ? `${section.wordCount} / ${section.targetWords} words`
      : `${section.wordCount} words`,
    section.deadline ? `due ${section.deadline}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

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

  async function onImagePick(file: File | null) {
    if (!file) return;
    try {
      const { blob, ext } = await compressImage(file);
      const path = await getContainer().report.uploadImage(section.id, blob, ext);
      setDraft((prev) => `${prev}\n${reportImageMarkdown(path, file.name)}\n`);
      setSaveError(null);
    } catch (err) {
      setSaveError(formatError(err));
    }
  }

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

      <div className="paper-note-head">
        {!readOnly && (
          <button
            type="button"
            className="entity-icon-btn danger"
            onClick={() => void remove()}
            disabled={busy}
            aria-label="Delete section"
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
        <div className="card-foot-right">
          {readOnly ? (
            <CommentsToggle
              resourceType="report_section"
              resourceId={section.id}
              canComment={canComment}
              variant="detail"
            />
          ) : (
            <>
              <ShareButton
                resourceType="report_section"
                resourceId={section.id}
                title={`Share: ${section.title}`}
              />
              {!editing && (
                <button
                  type="button"
                  className="entity-icon-btn"
                  onClick={() => {
                    setDraft(section.notes ?? "");
                    setEditing(true);
                  }}
                  aria-label={hasNotes ? "Edit note" : "Write note"}
                  title={hasNotes ? "Edit note" : "Write note"}
                >
                  <EditIcon />
                </button>
              )}
              {editing && (
                <button
                  type="button"
                  className="entity-icon-btn"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  aria-label="Add image"
                  title="Image"
                >
                  <ImageIcon />
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  void onImagePick(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
              <CommentsToggle resourceType="report_section" resourceId={section.id} canComment variant="detail" />
            </>
          )}
        </div>
      </div>

      <h1 className="paper-article-title">
        {section.sectionNo && <span className="muted">{section.sectionNo} </span>}
        {section.title}
      </h1>
      {meta && <p className="muted paper-article-by">{meta}</p>}

      <div className="section-note-layout">
      <div className="paper-note-body">
        {!editing ? (
          hasNotes ? (
            <ReportSectionMarkdown
              body={section.notes!}
              className="summary"
              skipArtifactResolve={readOnly}
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
            />
            <div className="summary-editor-foot">
              {saveError && <span className="error">{saveError}</span>}
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
