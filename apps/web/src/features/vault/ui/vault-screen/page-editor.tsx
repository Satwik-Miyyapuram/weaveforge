"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { vaultImageMarkdown, type VaultPage } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { AttachImageButton } from "@/components/attach-image-button";
import { CitationFormatSelect } from "@/components/citation-format-select";
import type { EditorHandle } from "@/components/editor-handle";
import { MarkdownCodeEditor } from "@/components/markdown/markdown-code-editor-lazy";
import { DeleteIcon, EditIcon } from "@/components/view-icons";
import { CollabBodyHost } from "@/features/collab";
import { ShareButton, CommentsToggle, PinnedPaperBadge } from "@/features/sharing";
import { editorImageUpload } from "@/lib/editor-image-upload";
import { formatError } from "@/lib/format-error";
import { useCitationFormatPreference } from "@/lib/hooks/use-citation-format-preference";
import { useCiteLinkCatalog, type CiteCompletion } from "@/lib/hooks/use-cite-links";
import { materializeBlobImagesInBody } from "../../lib/materialize-blob-images";
import { VaultMarkdown } from "../vault-markdown";
import { NoteTagEditor } from "./note-tag-editor";

export function PageEditor({
  page,
  readOnly = false,
  sharedPage = false,
  sharedByName,
  canComment = false,
  notes = [],
  papers = [],
  sections = [],
  onCreateNote,
  resolveEmbed,
  onChanged,
  onDeleted,
}: {
  page: VaultPage;
  readOnly?: boolean;
  sharedPage?: boolean;
  sharedByName?: string;
  canComment?: boolean;
  notes?: { id: string; title: string }[];
  papers?: { id: string; title: string }[];
  sections?: { id: string; title: string }[];
  onCreateNote?: (title: string) => void;
  resolveEmbed?: (title: string) => string | null;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(page.title);
  const [draft, setDraft] = useState(page.body);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Filled in by whichever editor is mounted — plain or collaborative — and
  // empty while the note is being read rather than written.
  const editorHandle = useRef<EditorHandle | null>(null);
  const { completions: wikilinkCompletions } = useCiteLinkCatalog();
  const [citationFormat, setCitationFormat] = useCitationFormatPreference();
  const wikilinkTitles = useMemo(
    () => [...notes.map((n) => n.title), ...papers.map((p) => p.title), ...sections.map((s) => s.title)],
    [notes, papers, sections],
  );

  const collabRef = useRef(false);
  // Described as data, not as a CodeMirror extension array: building the stack
  // here meant importing CodeMirror into this screen, which put the whole
  // editor in /notes' first-load bundle even for a reader who never edits.
  // `CollabBodyHost` builds it inside its own lazily-loaded chunk.
  /**
   * Accepting a pasted image. Stored against the page, referenced as `vault:`.
   * Kept out of the memo below on purpose: it closes over `page.id`, and the
   * collaborative editor rebuilds its whole document when its extension array
   * changes.
   */
  const imagePaste = useMemo(
    () =>
      editorImageUpload({
        store: (blob, ext) => getContainer().vault.uploadAsset(page.id, blob, ext),
        toMarkdown: vaultImageMarkdown,
        onError: setSaveError,
      }),
    [page.id],
  );

  const collabEditing = useMemo(
    () => ({
      placeholder: "Write markdown… #hashtags and [[wikilinks]] link this note in the graph.",
      wikilinkTitles,
      wikilinkCompletions,
      citationFormat,
      imagePaste,
    }),
    [wikilinkTitles, wikilinkCompletions, citationFormat, imagePaste],
  );

  useEffect(() => {
    setTitle(page.title);
    setDraft(page.body);
    setSaveError(null);
    // A body change closes the plain editor because its `draft` would otherwise
    // be stale against the row. The collaborative editor has no such problem —
    // its document *is* the shared state — and closing it here would shut the
    // editor under the user every time their own autosave came back around.
    if (!collabRef.current) setEditing(false);
  }, [page.id, page.title, page.body]);

  useEffect(() => {
    if (page.id) setEditing(false);
  }, [page.id]);

  const canEditBody = !readOnly;
  const canEditTitle = canEditBody && !sharedPage;
  const showEditor = editing && canEditBody;
  const hasBody = !!page.body.trim();
  const titleDirty = canEditTitle && title.trim() !== page.title;
  const bodyDirty = draft !== page.body;

  // Co-editing is for notes you own and can write to. A shared or read-only
  // page has no edit affordance at all, and pushing CRDT updates for one would
  // mean joining a channel the viewer has no write authorization on.
  const collab = canEditBody && !sharedPage && getContainer().collab.enabled();
  collabRef.current = collab;
  // With collab on the body persists itself, so only the title can be dirty.
  const dirty = collab ? titleDirty : titleDirty || bodyDirty;

  /**
   * Autosave from the collaborative editor: body only, and no `setEditing(false)`.
   * Title stays on "Save note" — it is a plain input, not part of the CRDT
   * document, so it has no other way to be persisted.
   */
  const saveCollabBody = useCallback(
    async (nextBody: string) => {
      setDraft(nextBody);
      const vault = getContainer().vault;
      const body = await materializeBlobImagesInBody(nextBody, page.id, (id, blob, ext) =>
        vault.uploadAsset(id, blob, ext),
      );
      await vault.manageVaultPage.update(page.id, { body });
    },
    [page.id],
  );

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const vault = getContainer().vault;
      const body = await materializeBlobImagesInBody(draft, page.id, (id, blob, ext) =>
        vault.uploadAsset(id, blob, ext),
      );
      await vault.manageVaultPage.update(page.id, {
        title: canEditTitle ? title.trim() : page.title,
        body,
      });
      setEditing(false);
      await onChanged();
    } catch (err) {
      setSaveError(formatError(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete “${page.title}”?`)) return;
    await getContainer().vault.manageVaultPage.remove(page.id);
    onDeleted();
  }

  function closeEditor() {
    setTitle(page.title);
    setSaveError(null);
    setEditing(false);
    void onChanged();
  }

  function cancelEdit() {
    setTitle(page.title);
    setDraft(page.body);
    setSaveError(null);
    setEditing(false);
  }

  return (
    <>
      <div className="vault-editor-head paper-note-head">
        {!sharedPage && canEditTitle && !readOnly && (
          <button
            type="button"
            className="entity-icon-btn danger"
            onClick={() => void remove()}
            disabled={saving}
            aria-label="Delete note"
            title="Delete"
          >
            <DeleteIcon />
          </button>
        )}
        <div className="card-foot-right">
          {readOnly ? (
            <CommentsToggle resourceType="vault_page" resourceId={page.id} canComment={canComment} variant="detail" />
          ) : (
            <>
              {!sharedPage && (
                <ShareButton resourceType="vault_page" resourceId={page.id} title={`Share: ${page.title}`} />
              )}
              {!showEditor && canEditBody && (
                <button
                  type="button"
                  className="entity-icon-btn"
                  onClick={() => {
                    setDraft(page.body);
                    setTitle(page.title);
                    setEditing(true);
                  }}
                  aria-label={hasBody ? "Edit note" : "Write note"}
                  title={hasBody ? "Edit note" : "Write note"}
                >
                  <EditIcon />
                </button>
              )}
              {showEditor && canEditBody && (
                <AttachImageButton editor={editorHandle} onError={setSaveError} />
              )}
              {!readOnly && (
                <CommentsToggle resourceType="vault_page" resourceId={page.id} canComment variant="detail" />
              )}
            </>
          )}
        </div>
      </div>

      {readOnly || sharedPage || !showEditor || !canEditTitle ? (
        <div className="vault-title-readonly">
          <h2 className="paper-article-title">{page.title}</h2>
          {sharedByName && <PinnedPaperBadge ownerName={sharedByName} />}
        </div>
      ) : (
        <input
          className="vault-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Note title"
        />
      )}

      {!showEditor ? (
        hasBody ? (
          <VaultMarkdown
            body={page.body}
            className="summary"
            notes={notes}
            papers={papers}
            sections={sections}
            onCreateNote={onCreateNote}
            resolveEmbed={resolveEmbed}
          />
        ) : (
          <p className="muted summary-empty">No content yet — use “Write note” to start.</p>
        )
      ) : (
        <div className="summary-editor">
          <div className="summary-editor-bar">
            <CitationFormatSelect
              value={citationFormat}
              onChange={setCitationFormat}
              disabled={saving}
            />
          </div>
          {collab ? (
            <CollabBodyHost
              resourceType="vault_page"
              resourceId={page.id}
              initialBody={page.body}
              onSave={saveCollabBody}
              className="summary-input-collab"
              editorClassName="markdown-code-editor summary-input markdown-code-editor--notes"
              markdownEditing={collabEditing}
              handleRef={editorHandle}
            />
          ) : (
            <MarkdownCodeEditor
              className="summary-input markdown-code-editor--notes"
              value={draft}
              placeholder="Write markdown… #hashtags and [[wikilinks]] link this note in the graph."
              disabled={saving}
              onChange={setDraft}
              wikilinkTitles={wikilinkTitles}
              wikilinkCompletions={wikilinkCompletions}
              citationFormat={citationFormat}
              imagePaste={imagePaste}
              handleRef={editorHandle}
            />
          )}
          <div className="summary-editor-foot">
            {saveError && <span className="error">{saveError}</span>}
            {/* Cancelling a collaborative edit cannot roll the body back — it is
                already shared and saved — so the escape hatch is just "close". */}
            <button type="button" className="link-btn" onClick={collab ? closeEditor : cancelEdit} disabled={saving}>
              {collab ? "close" : "cancel"}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={saving || (!dirty && !collab) || !title.trim()}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : collab ? "Done" : "Save note"}
            </button>
          </div>
        </div>
      )}
      {!showEditor && canEditBody && (
        <NoteTagEditor page={page} onChanged={onChanged} />
      )}
    </>
  );
}
