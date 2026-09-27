"use client";

import { InlineError } from "@/components/form-error";
import { useCallback, useEffect, useRef, useState } from "react";
import { REPORT_STATUSES, type ReportSection, type ReportStatus } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Select } from "@/components/select";
import { BackButton } from "@/components/back-button";
import { DocumentBody } from "@/components/document-body";
import { DocumentModeSwitch } from "@/components/document-mode-switch";
import { CardMenu } from "@/components/card-menu";
import { ShareButton, CommentsToggle, PinnedPaperBadge } from "@/features/sharing";
import type { EditorHandle } from "@/components/editor-handle";
import { AttachImageButton } from "@/components/attach-image-button";
import { formatError } from "@/lib/format-error";
import { useCiteLinkCatalog } from "@/lib/hooks/use-cite-links";
import { CitationFormatSelect } from "@/components/citation-format-select";
import { useCitationFormatPreference } from "@/lib/hooks/use-citation-format-preference";
import { materializeReportBlobImages } from "../lib/report-images-md";
import { SectionRelatedExcerpts } from "./section-related-excerpts";
import { ExperimentArtifactPicker } from "./experiment-artifact-picker";

/** A section's two views, in the order the Editor's pane header lists them. */
const SECTION_MODES = ["edit", "read"] as const;
type SectionMode = (typeof SECTION_MODES)[number];

/**
 * Full-page section writing view: back, status and word progress, one
 * toolbar (Edit / Read, comments, share, more), then the section through the
 * Editor's document host.
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
  // Read or Edit, as in the Editor's pane header. A section opens read.
  const [mode, setMode] = useState<SectionMode>("read");
  const editing = !readOnly && mode === "edit";
  const [saveError, setSaveError] = useState<string | null>(null);
  // Filled in while the editor is on screen, so the buttons can insert at the caret.
  const editorHandle = useRef<EditorHandle | null>(null);
  const { completions } = useCiteLinkCatalog();
  const [citationFormat, setCitationFormat] = useCitationFormatPreference();

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

  /** Every body write. The host saves as it goes, the way it does in the Editor. */
  const saveNotes = useCallback(
    async (nextBody: string) => {
      setSaveError(null);
      try {
        const report = getContainer().report;
        const body = await materializeReportBlobImages(nextBody, section.id, (id, blob, ext) =>
          report.uploadImage(id, blob, ext),
        );
        onReplace(await report.manageReportSection.setNotes(section.id, body));
      } catch (err) {
        setSaveError(formatError(err));
      }
    },
    [onReplace, section.id],
  );

  /**
   * A snippet from the pickers: at the caret while editing, else added to the
   * end of the section, which stays in Read so the reader sees it land.
   */
  function insertSnippet(snippet: string) {
    const editor = editorHandle.current;
    if (editing && editor) {
      editor.insert(`\n\n${snippet}\n`);
      return;
    }
    void saveNotes(`${(section.notes ?? "").trimEnd()}\n\n${snippet}\n`);
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
      <BackButton label="Report" onClick={onBack} />

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
        {!readOnly && <DocumentModeSwitch modes={SECTION_MODES} mode={mode} onMode={setMode} />}
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

      <div className={editing ? "section-note-layout section-note-layout--editing" : "section-note-layout"}>
      <div className="paper-note-body">
        {!editing && !hasNotes ? (
          readOnly ? (
            <p className="muted summary-empty">No note yet.</p>
          ) : (
            <button type="button" className="record-note-empty" onClick={() => setMode("edit")}>
              No note yet. Start writing — cite with [[ or @, math with $E = mc^2$.
            </button>
          )
        ) : (
          <div className={editing ? "record-doc record-doc--edit" : "summary"}>
            {editing && (
              <div className="summary-editor-bar">
                <CitationFormatSelect value={citationFormat} onChange={setCitationFormat} />
                <ExperimentArtifactPicker disabled={busy} onInsert={insertSnippet} />
                <AttachImageButton editor={editorHandle} onError={setSaveError} />
              </div>
            )}
            {/* The Editor's own document host, as a section tab mounts it:
                Edit and Read here are that code, not a copy of it. */}
            <DocumentBody
              tab={{ kind: "report_section", id: section.id }}
              mode={editing ? "edit" : "read"}
              body={section.notes ?? ""}
              completions={completions}
              citationFormat={citationFormat}
              skipArtifactResolve={sharedContent}
              onSave={readOnly ? async () => undefined : saveNotes}
              handleRef={editorHandle}
              onError={setSaveError}
            />
          </div>
        )}
        {saveError && <InlineError>{saveError}</InlineError>}
      </div>
      {!readOnly && !editing && <SectionRelatedExcerpts section={section} onInsert={insertSnippet} />}
      </div>
    </div>
  );
}
