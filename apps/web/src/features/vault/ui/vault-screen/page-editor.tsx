"use client";

import { InlineError } from "@/components/form-error";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  extractHashtags,
  isInkNoteBody,
  type VaultPage,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { readableText } from "@/lib/page-text";
import { AttachImageButton } from "@/components/attach-image-button";
import type { EditorHandle } from "@/components/editor-handle";
import { CommentsIcon, DeleteIcon, OpenIcon } from "@/components/view-icons";
import { RecordEmpty, RecordFacts, RecordSection, recordDate, wordCount } from "@/components/record";
import { DocumentBody } from "@/components/document-body";
import { DocumentModeSwitch } from "@/components/document-mode-switch";
import { RelatedPanel } from "@/components/related-panel";
import { NoteComments, ShareButton, PinnedPaperBadge } from "@/features/sharing";
import { formatError } from "@/lib/format-error";
import { useCiteLinkCatalog } from "@/lib/hooks/use-cite-links";
import { WORKSPACE_PATH } from "@/lib/hooks/use-workspace-route";
import { materializeBlobImagesInBody } from "../../lib/materialize-blob-images";
import { NoteTagEditor } from "./note-tag-editor";

/** A note's three views, in the order the Editor's pane header lists them. */
const NOTE_MODES = ["edit", "read", "ink"] as const;
type NoteMode = (typeof NOTE_MODES)[number];

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
  onBack,
  backlinks = [],
  onOpenPage,
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
  /** Back to the list; absent where the page is embedded rather than opened. */
  onBack?: () => void;
  /** Notes that [[wikilink]] here. */
  backlinks?: { id: string; title: string }[];
  onOpenPage?: (id: string) => void;
}) {
  const [title, setTitle] = useState(page.title);
  // Read, Edit or Ink, as in the Editor's pane header. A note opens read.
  const [mode, setMode] = useState<NoteMode>("read");
  const modeRef = useRef<NoteMode>("read");
  modeRef.current = mode;
  /** The rendered note, which margin comments select from and light up. */
  const noteTextRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Filled in while the editor is on screen, for the image button.
  const editorHandle = useRef<EditorHandle | null>(null);
  const { completions } = useCiteLinkCatalog();
  const links = useMemo(() => ({ notes, papers, sections }), [notes, papers, sections]);

  useEffect(() => {
    setTitle(page.title);
    setSaveError(null);
  }, [page.id, page.title]);

  useEffect(() => {
    if (page.id) setMode("read");
  }, [page.id]);

  // A handwritten note keeps its ink header and page markers in the body. Its
  // three modes are the Editor's, drawn by the Editor's own document host:
  // Edit the source, Read the sheet with the pen down, Ink the ink surface.
  const ink = isInkNoteBody(page.body);
  const readBody = useMemo(() => readableText(page.body), [page.body]);
  const canEditBody = !readOnly;
  const canEditTitle = canEditBody && !ink && !sharedPage;
  const view: NoteMode = canEditBody ? mode : "read";
  const hasBody = !!readBody.trim();

  /**
   * Every body write, from any mode — the host saves as it goes, the way it
   * does in the Editor. The list is refreshed from Read only: a new body
   * arriving mid-edit or mid-stroke would shut the surface under the writer,
   * so Edit and Ink refresh once they are put away (`chooseMode`).
   */
  const saveBody = useCallback(
    async (nextBody: string) => {
      setSaveError(null);
      try {
        const vault = getContainer().vault;
        const body = await materializeBlobImagesInBody(nextBody, page.id, (id, blob, ext) =>
          vault.uploadAsset(id, blob, ext),
        );
        await vault.manageVaultPage.update(page.id, { body });
        if (modeRef.current === "read") await onChanged();
      } catch (err) {
        setSaveError(formatError(err));
      }
    },
    [onChanged, page.id],
  );

  /** The title is a plain input beside the shared body: it saves when left. */
  async function saveTitle() {
    const next = title.trim();
    if (!canEditTitle || !next || next === page.title) {
      setTitle(page.title);
      return;
    }
    setBusy(true);
    setSaveError(null);
    try {
      await getContainer().vault.manageVaultPage.update(page.id, { title: next });
      await onChanged();
    } catch (err) {
      setSaveError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete “${page.title}”?`)) return;
    await getContainer().vault.manageVaultPage.remove(page.id);
    onDeleted();
  }

  /** The switch in the section head. Leaving Edit or Ink refreshes the list. */
  function chooseMode(next: NoteMode) {
    if (next === mode) return;
    setSaveError(null);
    if (mode !== "read") void onChanged();
    setMode(next);
  }

  const words = wordCount(readBody);
  const wordsLabel = `${words} ${words === 1 ? "word" : "words"}`;
  const tags = extractHashtags(readBody);
  const linksOut = new Set([...readBody.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1]!.trim().toLowerCase())).size;
  const edited = recordDate(page.updatedAt);
  const created = recordDate(page.createdAt);
  const meta = [
    created ? `Created ${created}` : null,
    edited && edited !== created ? `Edited ${edited}` : null,
    wordsLabel,
  ].filter(Boolean).join(" / ");

  const editorHref = `${WORKSPACE_PATH}?open=${encodeURIComponent(`vault_page:${page.id}`)}`;

  return (
    <article className="record">
      <nav className="record-bar" aria-label="Note">
        {onBack && <button type="button" className="record-back" onClick={onBack}>← Notes</button>}
        {sharedPage && <span className="record-mono record-bar-id">Shared</span>}
        {sharedByName && <PinnedPaperBadge ownerName={sharedByName} />}
        <div className="record-actions">
          {/* Writing here starts from the Edit / Read / Ink switch over the
              note; Open in editor leaves for the full Editor with its tabs and
              sidebar. */}
          {!readOnly && !sharedPage && (
            <Link className="record-action" href={editorHref}>
              <OpenIcon />
              <span>Open in editor</span>
            </Link>
          )}
          {!readOnly && !sharedPage && (
            <ShareButton resourceType="vault_page" resourceId={page.id} title={`Share: ${page.title}`} showLabel />
          )}
          <a href="#record-comments" className="record-action">
            <CommentsIcon />
            <span>Comment</span>
          </a>
          {!sharedPage && canEditTitle && !readOnly && (
            <button
              type="button"
              className="record-action danger"
              onClick={() => void remove()}
              disabled={busy}
              aria-label="Delete note"
              title="Delete"
            >
              <DeleteIcon />
            </button>
          )}
        </div>
      </nav>

      <header className="record-head">
        {view === "edit" && canEditTitle ? (
          <input
            className="vault-title-input record-title-input"
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setTitle(page.title);
            }}
            aria-label="Note title"
          />
        ) : (
          <h1 className="record-title">{page.title}</h1>
        )}
        <p className="record-mono record-meta">{meta}</p>
      </header>

      <div className="record-grid">
        <div className="record-main">
          <RecordSection
            label={ink ? "Pages" : "Text"}
            tag={
              canEditBody ? (
                <span className="record-mode-tag">
                  {hasBody && <span>{wordsLabel}</span>}
                  <DocumentModeSwitch modes={NOTE_MODES} mode={view} onMode={chooseMode} />
                </span>
              ) : hasBody ? wordsLabel : undefined
            }
          >
            {view === "read" && !hasBody && !ink ? (
              canEditBody ? (
                <button type="button" className="record-note-empty" onClick={() => chooseMode("edit")}>
                  Nothing written yet. Start typing — #hashtags and [[wikilinks]] join this note to the graph.
                </button>
              ) : (
                <RecordEmpty>Nothing written yet.</RecordEmpty>
              )
            ) : (
              <div
                ref={noteTextRef}
                className={view === "read" ? (ink ? "record-note-read record-note-read--ink" : "record-note-read") : `record-doc record-doc--${view}`}
              >
                {view === "edit" && (
                  <div className="summary-editor-bar">
                    <AttachImageButton editor={editorHandle} onError={setSaveError} />
                  </div>
                )}
                {/* The Editor's own document host: Edit, Read and Ink here are
                    the same code as in a tab, not a copy of it. */}
                <DocumentBody
                  tab={{ kind: "vault_page", id: page.id }}
                  mode={view}
                  body={page.body}
                  links={links}
                  completions={completions}
                  onSave={canEditBody ? saveBody : async () => undefined}
                  onCreateNote={onCreateNote ? (t) => onCreateNote(t) : undefined}
                  resolveEmbed={resolveEmbed}
                  handleRef={editorHandle}
                  onError={setSaveError}
                />
              </div>
            )}
            {saveError && <InlineError>{saveError}</InlineError>}
            {view === "read" && canEditBody && !ink && <NoteTagEditor page={page} onChanged={onChanged} />}
          </RecordSection>
        </div>

        <aside className="record-aside">
          <NoteComments
            resourceType="vault_page"
            resourceId={page.id}
            canComment={readOnly ? canComment : true}
            isOwner={!sharedPage && !readOnly}
            contentRef={noteTextRef}
            contentKey={`${view}:${page.body}`}
          />

          <RecordSection label="Record">
            <RecordFacts
              rows={[
                ["Created", created || "—"],
                edited && edited !== created ? ["Edited", edited] : null,
                ["Words", String(words)],
                ["Links out", String(linksOut)],
                ["Linked from", String(backlinks.length)],
                tags.length > 0 ? ["Tags", tags.map((t) => `#${t}`).join(" ")] : null,
              ]}
            />
          </RecordSection>

          <RecordSection label="Linked mentions" tag={backlinks.length > 0 ? String(backlinks.length) : "None"}>
            {backlinks.length > 0 ? (
              <ul className="record-related">
                {backlinks.map((it) => (
                  <li key={it.id}>
                    <button type="button" className="record-related-title record-link-btn" onClick={() => onOpenPage?.(it.id)}>
                      {it.title}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <RecordEmpty>No note links here yet. Write [[{page.title}]] in another note and it shows up here.</RecordEmpty>
            )}
          </RecordSection>

          {/* Backlinks are what points here; Related is what the graph, the
              wording and the meaning suggest is adjacent, linked or not. */}
          <RelatedPanel seedKind="note" seedId={page.id} variant="record" />
        </aside>
      </div>
    </article>
  );
}
