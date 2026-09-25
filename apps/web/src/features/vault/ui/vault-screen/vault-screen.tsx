"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  bodyLinksTo, extractHashtags, normalizeTitleKey,
  type VaultPage, type VaultPageSummary } from "@weaveforge/core";
import type { ReadingList } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ScreenLoading } from "@/components/screen-loading";
import { CardColumns } from "@/components/card-columns";
import { loadPinnedOwnerNames } from "@/features/sharing/application/load-pinned-owner-names";
import { AddVaultPageForm } from "../add-vault-page-form";
import { importNotesFromFiles } from "../../application/import-notes";
import { useScreenData } from "@/lib/hooks/use-screen-data";
import { useDetailBack, useDetailPushFlag } from "@/lib/hooks/use-detail-back";
import { emptyArray, emptyMap, emptySet } from "@/lib/empty";
import { usePersistedState } from "@/lib/hooks/use-persisted-state";
import { formatError } from "@/lib/format-error";
import { rememberRecentTarget } from "@/lib/recent-targets";
import { rankedFilter } from "@/features/search/application/rank-filter";
import { useSearchIndex } from "@/lib/hooks/use-search-index";
import { NoteCard, noteBodyText, isHydratedPage } from "./note-card";
import { PageEditor } from "./page-editor";
import type { VaultViewData } from "./types";
import { ListTagFilters } from "@/components/list-tag-filters";
import { ClearFiltersButton, EmptyState } from "@/components/empty-state";
import { NavIcon } from "@/app/nav-icon";
import { ScreenHead } from "@/components/screen-head";
import { FormError } from "@/components/form-error";

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

  // Which rows this project owns. Served by the use-case rather than derived
  // here from a tree that nothing renders — see `VaultScreenData.ownedIds`.
  const ownedIds = data?.ownedIds ?? emptySet<string>();
  // The list holds summaries; opening a note replaces that entry with the full
  // page. `VaultPage` is assignable to `VaultPageSummary`, so one array can hold
  // both — but the element type stays the summary, which forces a `.body` read
  // through `noteBodyText`/`isHydratedPage` instead of silently yielding
  // `undefined` (review-2 F6).
  const flat =
    data?.flat ?? emptyArray<VaultPageSummary | VaultPage>();
  const lists = data?.lists ?? emptyArray<ReadingList>();
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
    const existing = flat.find((p) => p.id === selectedId);
    // A hydrated entry is one that carries a `body` at all — including an empty
    // one, which is a real note, not a summary. Testing the value instead would
    // re-fetch every empty note forever.
    if (existing && isHydratedPage(existing)) {
      appliedPageFromUrl.current = selectedId;
      return;
    }
    // No "already hydrated" set here: the screen revalidates after a cached
    // paint, and that fresh list is summaries again. A set that remembered the
    // page as done left the summary in place and the note sat on "Opening
    // note…" for good — which is what a link into `/notes?page=` from another
    // screen hit every time. The repository caches the row, so asking again is
    // a lookup, not a round trip.
    let cancelled = false;
    void getContainer()
      .vault.getPage(selectedId)
      .then((p) => {
        if (cancelled || !p) return;
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
      setError(formatError(err));
    } finally {
      setImporting(false);
    }
  }

  /**
   * `![[Note]]` transclusion: resolve a note title to its body for inlining.
   *
   * Only a hydrated page can be transcluded: inlining a `bodyPreview` would
   * silently truncate the note. An entry that is still a summary answers `null`,
   * exactly as an absent one did, so the caller's "unresolved embed" path is
   * unchanged.
   */
  const resolveEmbed = useCallback(
    (title: string) => {
      const key = normalizeTitleKey(title);
      const page = flat.find((p) => normalizeTitleKey(p.title) === key);
      return page && isHydratedPage(page) ? page.body : null;
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
        setError(formatError(err));
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
    (notes: (VaultPageSummary | VaultPage)[]) => {
      const inAnyList = (id: string) =>
        listFilter.some((lid) => membership.get(lid)?.has(id) ?? false);
      const hasAnyTag = (p: VaultPageSummary | VaultPage) =>
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
      <ScreenHead eyebrow={hasNotes ? `${ownedNotes.length} ${ownedNotes.length === 1 ? "note" : "notes"}` : undefined}>
        <button
          className="btn-primary"
          type="button"
          disabled={importing}
          onClick={openCompose}
        >
          {importing ? "Importing…" : "New note"}
        </button>
        {/* Same button, same screen as on Papers — the wiki reads notes *and*
            papers, so neither screen owns it. See `papers-list.tsx`. */}
        <button className="btn-secondary" type="button" onClick={() => router.push("/wiki")}>
          Wiki
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
      </ScreenHead>

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

      {error && <FormError>{error}</FormError>}
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
          <ListTagFilters
            idPrefix="fn"
            lists={lists}
            listFilter={listFilter}
            onListFilter={setListFilter}
            allTags={allTags}
            tagFilter={tagFilter}
            onTagFilter={setTagFilter}
            activeFilters={activeFilters}
            onClear={() => { setListFilter([]); setTagFilter([]); }}
          />
        </div>
      )}

      {!error && (
        selected ? (
          <div className="vault-note-page">
            {/* The editor binds its draft state to `page.body` in a
                `useState` initialiser, so it must never be handed a summary:
                the draft would start as `undefined` and the first save would
                write an empty body over the note (review-2 F6). Until the
                hydration effect above has replaced this entry with the full
                page, show the loading row instead. `isHydratedPage` tests for
                the property, not its value, so an intentionally empty note
                still reaches the editor. */}
            {!isHydratedPage(selected) ? (
              <ScreenLoading status="Opening note…" />
            ) : (
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
                onBack={goBackToList}
                backlinks={backlinks}
                onOpenPage={openPage}
              />
            )}
          </div>
        ) : ownedNotes.length === 0 && pinnedPages.length === 0 ? (
          <EmptyState
            variant="first-run"
            icon={<NavIcon name="notes" />}
            title="No notes yet"
            body="Notes are where the reading becomes yours: the derivation you worked through, the paragraph you will still want to quote in eight months. Link them with [[ ]] and they join the graph."
            action={
              <button
                type="button"
                className="btn-primary"
                onClick={() => { setComposeMode("new"); setComposeOpen(true); }}
              >
                New note
              </button>
            }
          />
        ) : visibleCount === 0 ? (
          <EmptyState
            variant="no-results"
            body="No notes match the filter."
            action={
              <ClearFiltersButton
                onClear={() => {
                  setSearch("");
                  setListFilter([]);
                  setTagFilter([]);
                }}
              />
            }
          />
        ) : (
          <>
            {visibleOwned.length > 0 && (
              <CardColumns
                items={visibleOwned}
                getKey={(p) => p.id}
                deferOffscreen={visibleOwned.length > 20}
                renderItem={(p) => (
                  <NoteCard page={p} onOpen={() => openPage(p.id)} onChanged={load} />
                )}
              />
            )}
            {visiblePinned.length > 0 && (
              <>
                <h4 className="settings-group vault-pinned-label">Shared with you</h4>
                <CardColumns
                  items={visiblePinned}
                  getKey={(p) => p.id}
                  deferOffscreen={visiblePinned.length > 20}
                  renderItem={(p) => (
                    <NoteCard
                      page={p}
                      readOnly
                      sharedByName={sharedOwnerName(p.id)}
                      onOpen={() => openPage(p.id)}
                      onChanged={load}
                    />
                  )}
                />
              </>
            )}
          </>
        )
      )}
    </section>
  );
}

