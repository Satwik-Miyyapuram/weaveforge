"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  bodyLinksTo,
  extractHashtags,
  normalizeTitleKey,
  vaultImageMarkdown,
  type VaultPage,
  type VaultPageTreeNode,
} from "@weaveforge/core";
import { removeHashtagFromBody } from "@/features/papers/lib/note-tags";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ScreenLoading } from "@/components/screen-loading";
import { Popover } from "@/components/popover";
import { DeleteIcon, EditIcon, FilterIcon, ImageIcon } from "@/components/view-icons";
import { EntityCard } from "@/components/entity-card";
import { MultiSelect } from "@/components/multi-select";
import { ShareButton, CommentsToggle, PinnedPaperBadge } from "@/features/sharing";
import { loadPinnedOwnerNames } from "@/features/sharing/application/load-pinned-owner-names";
import { AddVaultPageForm } from "./add-vault-page-form";
import { importNotesFromFiles } from "../application/import-notes";
import { VaultMarkdown } from "./vault-markdown";
import { materializeBlobImagesInBody } from "../lib/materialize-blob-images";
import { compressImage } from "@/lib/image-compress";
import { useScreenData } from "@/lib/use-screen-data";
import { useDetailBack, useDetailPushFlag } from "@/lib/use-detail-back";
import { emptyArray, emptyMap } from "@/lib/empty";
import { cardSnippet } from "@/lib/card-snippet";
import { usePersistedState } from "@/lib/use-persisted-state";
import { formatError } from "@/lib/format-error";
import { MarkdownCodeEditor } from "@/components/markdown-code-editor-lazy";
import { CollabBodyHost } from "@/features/collab";
import { useCiteLinkCatalog, type CiteCompletion } from "@/lib/use-cite-links";
import { CitationFormatSelect } from "@/components/citation-format-select";
import { useCitationFormatPreference } from "@/lib/use-citation-format-preference";
import type { VaultScreenData } from "@/features/vault/application/load-vault-screen.use-case";
import { rememberRecentTarget } from "@/lib/recent-targets";
import { rankedFilter } from "@/features/search/application/rank-filter";
import { RelatedPanel } from "@/components/related-panel";
import { useSearchIndex } from "@/lib/use-search-index";

type VaultViewData = VaultScreenData & {
  ownerNames: Map<string, string>;
  /** Title/id pairs for `[[wikilink]]` resolution to papers. */
  paperEntries: { id: string; title: string }[];
  /** Title/id pairs for report section wikilinks. */
  sectionEntries: { id: string; title: string }[];
};

/** Obsidian-like vault: nested page tree + markdown editor with image embeds. */
export function VaultScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("page");
  const isSharedView = searchParams.get("shared") === "1";

  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<"menu" | "new">("menu");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const importZipRef = useRef<HTMLInputElement | null>(null);
  const importFolderRef = useRef<HTMLInputElement | null>(null);
  // File inputs stay mounted outside the modal so pickers survive dialog close.
  const [listFilter, setListFilter] = usePersistedState<string[]>("thesis.notes.list", []);
  const [tagFilter, setTagFilter] = usePersistedState<string[]>("thesis.notes.tags", []);
  const [search, setSearch] = usePersistedState<string>("thesis.notes.search", "");
  const appliedPageFromUrl = useRef<string | null>(null);
  const hydratedPageIds = useRef(new Set<string>());
  const { setPushed, consumePushed } = useDetailPushFlag();
  const goBackToList = useDetailBack("/notes", "page", consumePushed);

  const loadScreen = useCallback(async (): Promise<VaultViewData> => {
    const data = await getContainer().vault.loadScreenData();
    const [ownerNames, papersData, reportData] = await Promise.all([
      loadPinnedOwnerNames(data.pinnedSharedBy),
      getContainer().papers.loadScreenData().catch(() => null),
      getContainer().report.loadScreenData().catch(() => null),
    ]);
    const paperEntries = (papersData?.papers ?? []).map((p) => ({ id: p.id, title: p.title }));
    const sectionEntries = (reportData?.flat ?? []).map((s) => ({ id: s.id, title: s.title }));
    return { ...data, ownerNames, paperEntries, sectionEntries };
  }, []);

  const { data, loading, error: loadError, reload: load, setData } = useScreenData("vault", loadScreen);
  const searchIndex = useSearchIndex();

  useEffect(() => {
    setError(loadError);
  }, [loadError]);

  const tree = data?.tree ?? emptyArray<import("@weaveforge/core").VaultPageTreeNode>();
  const flat = data?.flat ?? emptyArray<import("@weaveforge/core").VaultPage>();
  const lists = data?.lists ?? emptyArray<import("@weaveforge/core").ReadingList>();
  const membership = data?.membership ?? emptyMap<string, Set<string>>();
  const pinnedSharedBy = data?.pinnedSharedBy ?? emptyMap<string, string>();
  const vaultCanComment = data?.vaultCanComment ?? emptyMap<string, boolean>();
  const vaultCanEdit = data?.vaultCanEdit ?? emptyMap<string, boolean>();
  const ownerNames = data?.ownerNames ?? emptyMap<string, string>();
  const paperEntries = data?.paperEntries ?? emptyArray<{ id: string; title: string }>();
  const sectionEntries = data?.sectionEntries ?? emptyArray<{ id: string; title: string }>();
  const noteEntries = useMemo(
    () => flat.map((p) => ({ id: p.id, title: p.title })),
    [flat],
  );
  const backlinks = useMemo(() => {
    if (!selectedId) return [] as { id: string; title: string }[];
    const target = flat.find((p) => p.id === selectedId);
    if (!target) return [];
    const key = normalizeTitleKey(target.title);
    return flat
      .filter((p) => p.id !== target.id && bodyLinksTo(noteBodyText(p), key))
      .map((p) => ({ id: p.id, title: p.title }));
  }, [selectedId, flat]);

  const selected = useMemo(
    () => flat.find((p) => p.id === selectedId) ?? null,
    [flat, selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    rememberRecentTarget(getContainer().projects.context.projectId, {
      kind: "note",
      id: selected.id,
      title: selected.title,
      href: `/notes?page=${encodeURIComponent(selected.id)}`,
    });
  }, [selected]);

  const ownedIds = useMemo(
    () => new Set(tree.flatMap((n) => collectIds(n))),
    [tree],
  );

  const pinnedPages = useMemo(
    () => flat.filter((p) => pinnedSharedBy.has(p.id) && !ownedIds.has(p.id)),
    [flat, pinnedSharedBy, ownedIds],
  );

  const upsertFlatPage = useCallback(
    (p: VaultPage) => {
      setData((prev) => {
        if (!prev) return prev;
        const idx = prev.flat.findIndex((x) => x.id === p.id);
        if (idx < 0) return { ...prev, flat: [...prev.flat, p] };
        const flat = prev.flat.slice();
        flat[idx] = p;
        return { ...prev, flat };
      });
    },
    [setData],
  );

  // Hydrate full body when opening a note (screen list uses summary projection).
  useEffect(() => {
    if (!selectedId) {
      appliedPageFromUrl.current = null;
      return;
    }
    if (hydratedPageIds.current.has(selectedId)) {
      appliedPageFromUrl.current = selectedId;
      return;
    }
    const existing = flat.find((p) => p.id === selectedId);
    if (existing?.body) {
      hydratedPageIds.current.add(selectedId);
      appliedPageFromUrl.current = selectedId;
      return;
    }

    let cancelled = false;
    void getContainer()
      .vault.getPage(selectedId)
      .then((p) => {
        if (cancelled || !p) return;
        hydratedPageIds.current.add(selectedId);
        appliedPageFromUrl.current = selectedId;
        upsertFlatPage(p);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, flat, upsertFlatPage]);

  const isSharedPage = useCallback(
    (pageId: string) => isSharedView || pinnedSharedBy.has(pageId),
    [isSharedView, pinnedSharedBy],
  );

  const isReadOnlyPage = useCallback(
    (pageId: string) => isSharedPage(pageId) && !vaultCanEdit.get(pageId),
    [isSharedPage, vaultCanEdit],
  );

  const sharedOwnerName = useCallback(
    (pageId: string) => {
      const ownerId = pinnedSharedBy.get(pageId);
      return ownerId ? ownerNames.get(ownerId) : undefined;
    },
    [pinnedSharedBy, ownerNames],
  );

  function openPage(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", id);
    setPushed();
    router.push(`/notes?${params.toString()}`);
  }

  function closeCompose() {
    setComposeOpen(false);
    setComposeMode("menu");
  }

  function openCompose() {
    setComposeMode("menu");
    setComposeOpen(true);
  }

  async function onImportFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    closeCompose();
    setImporting(true);
    setImportMsg(null);
    setError(null);
    try {
      const res = await importNotesFromFiles(Array.from(fileList));
      const parts = [`Imported ${res.created} note${res.created === 1 ? "" : "s"}`];
      if (res.folders) parts.push(`${res.folders} folder${res.folders === 1 ? "" : "s"}`);
      if (res.renamed.length) parts.push(`${res.renamed.length} renamed`);
      if (res.skipped) parts.push(`${res.skipped} non-markdown skipped`);
      setImportMsg(`${parts.join(", ")}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  /** `![[Note]]` transclusion: resolve a note title to its body for inlining. */
  const resolveEmbed = useCallback(
    (title: string) => {
      const key = normalizeTitleKey(title);
      return flat.find((p) => normalizeTitleKey(p.title) === key)?.body ?? null;
    },
    [flat],
  );

  /** Clicking an unresolved `[[wikilink]]` creates that note and opens it. */
  const createNoteFromLink = useCallback(
    async (title: string) => {
      try {
        const page = await getContainer().vault.manageVaultPage.add({ title });
        await load();
        const params = new URLSearchParams(searchParams.toString());
        params.set("page", page.id);
        setPushed();
        router.push(`/notes?${params.toString()}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [load, searchParams, setPushed, router],
  );

  const parents = flat.filter((p) => !p.parentId && !pinnedSharedBy.has(p.id));
  const ownedNotes = useMemo(
    () => flat.filter((p) => ownedIds.has(p.id) && !pinnedSharedBy.has(p.id)),
    [flat, ownedIds, pinnedSharedBy],
  );

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const p of flat) for (const t of extractHashtags(noteBodyText(p))) set.add(t);
    return [...set].sort();
  }, [flat]);

  const activeFilters = (listFilter.length ? 1 : 0) + (tagFilter.length ? 1 : 0);
  const hasNotes = ownedNotes.length > 0 || pinnedPages.length > 0;

  const filterNotes = useCallback(
    (notes: VaultPage[]) => {
      const inAnyList = (id: string) =>
        listFilter.some((lid) => membership.get(lid)?.has(id) ?? false);
      const hasAnyTag = (p: VaultPage) =>
        tagFilter.some((t) => extractHashtags(noteBodyText(p)).includes(t));
      // List and tag filters first: they are cheap set membership, and the
      // ranked pass should only order what survives them.
      const scoped = notes.filter(
        (p) =>
          (listFilter.length === 0 || inAnyList(p.id)) &&
          (tagFilter.length === 0 || hasAnyTag(p)),
      );
      return rankedFilter({
        items: scoped,
        query: search,
        kinds: ["note"],
        search: searchIndex,
        idOf: (p) => p.id,
        fallbackText: (p) => `${p.title}\n${noteBodyText(p)}`,
      });
    },
    [search, listFilter, tagFilter, membership, searchIndex],
  );

  const visibleOwned = useMemo(() => filterNotes(ownedNotes), [ownedNotes, filterNotes]);
  const visiblePinned = useMemo(() => filterNotes(pinnedPages), [pinnedPages, filterNotes]);
  const visibleCount = visibleOwned.length + visiblePinned.length;

  if (loading) {
    return <ScreenLoading status="Loading notes…" className="screen vault-screen" />;
  }

  return (
    <section className="screen vault-screen">
      <header className="screen-head">
        <div className="head-row">
          <div className="screen-actions">
            <button
              className="btn-primary"
              type="button"
              disabled={importing}
              onClick={openCompose}
            >
              {importing ? "Importing…" : "+ Note"}
            </button>
            <input
              ref={importZipRef}
              type="file"
              hidden
              accept=".zip,application/zip"
              onChange={(e) => {
                void onImportFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={(el) => {
                importFolderRef.current = el;
                if (el) {
                  el.setAttribute("webkitdirectory", "");
                  el.setAttribute("directory", "");
                }
              }}
              type="file"
              hidden
              multiple
              onChange={(e) => {
                void onImportFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      </header>

      {composeOpen && (
        <Modal
          title={composeMode === "new" ? "New note" : "Add notes"}
          onClose={closeCompose}
        >
          {composeMode === "menu" ? (
            <div className="org-modal-choices">
              <button
                type="button"
                className="org-choice-card"
                onClick={() => setComposeMode("new")}
              >
                <span className="org-choice-title">New note</span>
                <p className="org-choice-desc">Create a blank markdown note.</p>
              </button>
              <button
                type="button"
                className="org-choice-card"
                disabled={importing}
                onClick={() => importZipRef.current?.click()}
              >
                <span className="org-choice-title">Import zip</span>
                <p className="org-choice-desc">
                  Upload a .zip of markdown notes (Obsidian vault, Notion export, …).
                </p>
              </button>
              <button
                type="button"
                className="org-choice-card"
                disabled={importing}
                onClick={() => importFolderRef.current?.click()}
              >
                <span className="org-choice-title">Import folder</span>
                <p className="org-choice-desc">Pick a local folder of markdown notes.</p>
              </button>
            </div>
          ) : (
            <AddVaultPageForm
              parents={parents.map((p) => ({ id: p.id, title: p.title }))}
              onClose={closeCompose}
              onAdded={(id) => {
                closeCompose();
                void load().then(() => openPage(id));
              }}
            />
          )}
        </Modal>
      )}

      {error && <p className="error">{error}</p>}
      {importMsg && <p className="muted vault-import-msg">{importMsg}</p>}

      {!error && !selected && hasNotes && (
        <div className="controls-row">
          <input
            className="search-input"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or content…"
            aria-label="Search notes"
          />
          <Popover
            label={<FilterIcon />}
            ariaLabel="Filters"
            iconOnly
            count={activeFilters}
            align="right"
          >
            <div className="filters">
              {lists.length > 0 && (
                <MultiSelect
                  id="fnlist"
                  values={listFilter}
                  onChange={setListFilter}
                  allLabel="All lists"
                  ariaLabel="Filter by list"
                  options={lists.map((l) => ({ value: l.id, label: l.name }))}
                />
              )}
              {allTags.length > 0 && (
                <MultiSelect
                  id="fntags"
                  values={tagFilter}
                  onChange={setTagFilter}
                  allLabel="All tags"
                  ariaLabel="Filter by tags"
                  options={allTags.map((t) => ({ value: t, label: `#${t}` }))}
                />
              )}
              {activeFilters > 0 && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => { setListFilter([]); setTagFilter([]); }}
                >
                  Clear filters
                </button>
              )}
            </div>
          </Popover>
        </div>
      )}

      {!error && (
        selected ? (
          <div className="vault-note-page">
            <button className="btn-secondary paper-back" onClick={goBackToList}>
              ← Notes
            </button>
            <article className="card paper-article vault-editor">
              <PageEditor
                page={selected}
                readOnly={isReadOnlyPage(selected.id)}
                sharedPage={isSharedPage(selected.id)}
                sharedByName={sharedOwnerName(selected.id)}
                canComment={vaultCanComment.get(selected.id) ?? false}
                notes={noteEntries}
                papers={paperEntries}
                sections={sectionEntries}
                onCreateNote={createNoteFromLink}
                resolveEmbed={resolveEmbed}
                onChanged={load}
                onDeleted={() => {
                  goBackToList();
                  void load();
                }}
              />
            </article>
            <BacklinksPanel items={backlinks} onOpen={openPage} />
            {/* Backlinks are what points here; Related is what the graph and
                wording suggest is adjacent, including things nobody linked. */}
            <RelatedPanel seedKind="note" seedId={selected.id} />
          </div>
        ) : ownedNotes.length === 0 && pinnedPages.length === 0 ? (
          <div className="empty"><p>No notes yet — use “+ Note” to create or import one.</p></div>
        ) : visibleCount === 0 ? (
          <div className="empty"><p>No notes match the filter.</p></div>
        ) : (
          <>
            {visibleOwned.length > 0 && (
              <div className={`paper-grid ${visibleOwned.length > 20 ? "long-list" : ""}`}>
                {visibleOwned.map((p) => (
                  <NoteCard key={p.id} page={p} onOpen={() => openPage(p.id)} onChanged={load} />
                ))}
              </div>
            )}
            {visiblePinned.length > 0 && (
              <>
                <h4 className="settings-group vault-pinned-label">Shared with you</h4>
                <div className={`paper-grid ${visiblePinned.length > 20 ? "long-list" : ""}`}>
                  {visiblePinned.map((p) => (
                    <NoteCard
                      key={p.id}
                      page={p}
                      readOnly
                      sharedByName={sharedOwnerName(p.id)}
                      onOpen={() => openPage(p.id)}
                      onChanged={load}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )
      )}
    </section>
  );
}

function collectIds(node: VaultPageTreeNode): string[] {
  return [node.page.id, ...node.children.flatMap(collectIds)];
}

/** "Linked mentions": notes that [[wikilink]] to the open note. */
function BacklinksPanel({ items, onOpen }: { items: { id: string; title: string }[]; onOpen: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <section className="card vault-backlinks">
      <h4 className="vault-backlinks__head">Linked mentions <span className="muted">{items.length}</span></h4>
      <ul className="vault-backlinks__list">
        {items.map((it) => (
          <li key={it.id}>
            <button type="button" className="link-btn" onClick={() => onOpen(it.id)}>{it.title}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Prefer full body; fall back to listSummaries preview for cards. */
function noteBodyText(page: VaultPage): string {
  return page.body || page.bodyPreview || "";
}

/** Papers-style card for a note: title + excerpt; click opens the full note. */
function NoteCard({
  page,
  readOnly = false,
  sharedByName,
  onOpen,
  onChanged,
}: {
  page: VaultPage;
  readOnly?: boolean;
  sharedByName?: string;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const preview = noteBodyText(page);
  const excerpt = cardSnippet(preview);
  const tags = useMemo(() => extractHashtags(preview), [preview]);

  async function remove() {
    if (!confirm(`Delete “${page.title}”?`)) return;
    setBusy(true);
    try {
      await getContainer().vault.manageVaultPage.remove(page.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <EntityCard
      className="paper-card"
      onActivate={onOpen}
      title={page.title}
      status={readOnly ? <PinnedPaperBadge ownerName={sharedByName} /> : undefined}
      tags={tags}
      onDelete={readOnly ? undefined : () => void remove()}
      deleteDisabled={busy}
      deleteAriaLabel="Delete note"
      actions={
        !readOnly ? (
          <ShareButton resourceType="vault_page" resourceId={page.id} title={`Share: ${page.title}`} />
        ) : undefined
      }
      onOpen={onOpen}
      openLabel="Open note"
    >
      {excerpt ? <p className="entity-card-snippet">{excerpt}</p> : null}
    </EntityCard>
  );
}

function PageEditor({
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
  const fileRef = useRef<HTMLInputElement>(null);
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
  const collabEditing = useMemo(
    () => ({
      placeholder: "Write markdown… #hashtags and [[wikilinks]] link this note in the graph.",
      wikilinkTitles,
      wikilinkCompletions,
      citationFormat,
    }),
    [wikilinkTitles, wikilinkCompletions, citationFormat],
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

  async function onImagePick(file: File | null) {
    if (!file) return;
    try {
      const isImage = file.type.startsWith("image/");
      const compressed = isImage ? await compressImage(file) : null;
      const blob = compressed?.blob ?? file;
      const ext = compressed?.ext ?? (file.name.split(".").pop()?.toLowerCase() || "png");
      const path = await getContainer().vault.uploadAsset(page.id, blob, ext);
      const snippet = `\n${vaultImageMarkdown(path, file.name)}\n`;
      setDraft((prev) => prev + snippet);
      setEditing(true);
      setSaveError(null);
    } catch (err) {
      setSaveError(formatError(err));
    }
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
                <button
                  type="button"
                  className="entity-icon-btn"
                  onClick={() => fileRef.current?.click()}
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
                onChange={(e) => void onImagePick(e.target.files?.[0] ?? null)}
              />
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

/** Tags parsed from the note body's #hashtags — delete removes the hashtag from the body. */
function NoteTagEditor({ page, onChanged }: { page: VaultPage; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const tags = extractHashtags(page.body);

  async function removeTag(tag: string) {
    setBusy(true);
    try {
      const body = removeHashtagFromBody(page.body, tag);
      await getContainer().vault.manageVaultPage.update(page.id, { body });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (tags.length === 0) return null;
  return (
    <div className="tag-editor">
      <div className="tag-chips">
        {tags.map((t) => (
          <span key={t} className="tag-chip editable">
            #{t}
            <button
              type="button"
              className="tag-del"
              aria-label={`Remove #${t}`}
              disabled={busy}
              onClick={() => void removeTag(t)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
