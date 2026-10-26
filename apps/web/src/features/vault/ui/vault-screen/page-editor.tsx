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
import { deletedMessage, removeLater } from "@/lib/toast";
import { noteKey } from "./note-key";
import { readableText } from "@/lib/page-text";
import { AttachImageButton } from "@/components/attach-image-button";
import type { EditorHandle } from "@/components/editor-handle";
import { CommentsIcon, DeleteIcon, OpenIcon } from "@/components/view-icons";
import { RecordEmpty, RecordFacts, RecordSection, recordDate, wordCount } from "@/components/record";
import { BackButton } from "@/components/back-button";
import { DocumentBody } from "@/components/document-body";
import { DocumentModeSwitch } from "@/components/document-mode-switch";
import { InkFocusButton, InkFocusExit, useInkFocus } from "@/components/ink-focus";
import { RelatedPanel } from "@/components/related-panel";
import { NoteComments, ShareButton, PinnedPaperBadge } from "@/features/sharing";
import { formatError } from "@/lib/format-error";
import { useCiteLinkCatalog } from "@/lib/hooks/use-cite-links";
import { WORKSPACE_PATH } from "@/lib/hooks/use-workspace-route";
import { materializeBlobImagesInBody } from "../../lib/materialize-blob-images";
import { NoteTagEditor } from "./note-tag-editor";
import { runNoteAction } from "./run-note-action";
import { RowButton } from "@/components/controls";
import { Button } from "@/components/button";

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
  focusTitle = false,
}: {
  page: VaultPage;
  readOnly?: boolean;
  sharedPage?: boolean;
  sharedByName?: string;
  canComment?: boolean;
  notes?: { id: string; title: string }[];
  papers?: { id: string; title: string }[];
  sections?: { id: string; title: string }[];
  onCreateNote?: (title: string, opts?: { open?: boolean }) => void;
  resolveEmbed?: (title: string) => string | null;
  onChanged: () => void;
  /** The note was deleted: leave it at once (the delete itself follows the Undo toast). */
  onDeleted: () => void;
  /** Back to the list; absent where the page is embedded rather than opened. */
  onBack?: () => void;
  /** Notes that [[wikilink]] here. */
  backlinks?: { id: string; title: string }[];
  onOpenPage?: (id: string) => void;
  /** A note New note just made: focus and select the title to type over. */
  focusTitle?: boolean;
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
  /** Whether the delete confirmation is up. */
  // Filled in while the editor is on screen, for the image button.
  const editorHandle = useRef<EditorHandle | null>(null);
  const { completions } = useCiteLinkCatalog();
  const links = useMemo(() => ({ notes, papers, sections }), [notes, papers, sections]);

  useEffect(() => {
    setTitle(page.title);
    setSaveError(null);
  }, [page.id, page.title]);

  useEffect(() => {
    // A note New note just made opens in Edit, where its title can be typed over.
    if (page.id) setMode(focusTitle ? "edit" : "read");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a page change picks the mode
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
  const inkFocus = useInkFocus(view === "ink");

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
        const { body, uploadError } = await materializeBlobImagesInBody(nextBody, page.id, (id, blob, ext) =>
          vault.uploadAsset(id, blob, ext),
        );
        await vault.manageVaultPage.update(page.id, { body });
        if (modeRef.current === "read") await onChanged();
        // The text is saved; a failed upload is still said out loud.
        if (uploadError) throw uploadError;
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

  // Rule D-07: back to the list at once; the delete runs when the Undo toast
  // closes, then the list reloads. A failed delete brings the note back with a toast.
  function remove() {
    removeLater({
      key: noteKey(page.id),
      message: deletedMessage(page.title, "Note"),
      remove: () => getContainer().vault.manageVaultPage.remove(page.id),
      onHidden: onDeleted,
      onDeleted: onChanged,
    });
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
        {onBack && <BackButton label="Notes" onClick={onBack} />}
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
          <Button variant="ghost" className="wf-tool" href="#record-comments" aria-label="Comment" title="Comment">
            <CommentsIcon />
          </Button>
          {!sharedPage && !readOnly && (
            <RowButton
              className="record-action danger"
              onClick={remove}
              disabled={busy}
              aria-label="Delete note"
              title="Delete"
            >
              <DeleteIcon />
            </RowButton>
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
            autoFocus={focusTitle}
            onFocus={(e) => { if (focusTitle) e.currentTarget.select(); }}
          />
        ) : (
          <h1 className="record-title">{page.title}</h1>
        )}
        <p className="record-mono record-meta">{meta}</p>
      </header>

      <div className={view === "edit" ? "record-grid record-grid--editing" : "record-grid"}>
        <div className="record-main">
          <RecordSection
            label={ink ? "Pages" : "Text"}
            tag={
              canEditBody ? (
                <span className="record-mode-tag">
                  {hasBody && <span>{wordsLabel}</span>}
                  <DocumentModeSwitch modes={NOTE_MODES} mode={view} onMode={chooseMode} />
                  {view === "ink" && <InkFocusButton onClick={inkFocus.toggle} />}
                </span>
              ) : hasBody ? wordsLabel : undefined
            }
          >
            {view === "read" && !hasBody && !ink ? (
              canEditBody ? (
                <RowButton className="record-note-empty" onClick={() => chooseMode("edit")}>
                  Nothing written yet. Start typing — #hashtags and [[wikilinks]] join this note to the graph.
                </RowButton>
              ) : (
                <RecordEmpty>Nothing written yet.</RecordEmpty>
              )
            ) : (
              <div
                ref={noteTextRef}
                className={view === "read" ? (ink ? "record-note-read record-note-read--ink" : "record-note-read") : `record-doc record-doc--${view}${inkFocus.focus ? " record-ink-focus is-focus" : ""}`}
              >
                {inkFocus.focus && <InkFocusExit onClick={inkFocus.toggle} />}
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
                  onCreateNote={onCreateNote}
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
                ["Links from here", String(linksOut)],
                ["Links here", String(backlinks.length)],
                tags.length > 0 ? ["Tags", tags.map((t) => `#${t}`).join(" ")] : null,
              ]}
            />
          </RecordSection>

          <RecordSection label="Links here" tag={backlinks.length > 0 ? String(backlinks.length) : undefined}>
            {backlinks.length > 0 ? (
              <ul className="record-related">
                {backlinks.map((it) => (
                  <li key={it.id}>
                    <RowButton className="record-related-title record-link-btn" onClick={() => onOpenPage?.(it.id)}>
                      {it.title}
                    </RowButton>
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
