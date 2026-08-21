"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  bodyLinksTo, extractHashtags, normalizeTitleKey, type VaultPage, type VaultPageTreeNode } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ScreenLoading } from "@/components/screen-loading";
import { Popover } from "@/components/popover";
import { FilterIcon } from "@/components/view-icons";
import { CardColumns } from "@/components/card-columns";
import { MultiSelect } from "@/components/multi-select";
import { loadPinnedOwnerNames } from "@/features/sharing/application/load-pinned-owner-names";
import { AddVaultPageForm } from "../add-vault-page-form";
import { importNotesFromFiles } from "../../application/import-notes";
import { useScreenData } from "@/lib/hooks/use-screen-data";
import { useDetailBack, useDetailPushFlag } from "@/lib/hooks/use-detail-back";
import { emptyArray, emptyMap } from "@/lib/empty";
import { usePersistedState } from "@/lib/hooks/use-persisted-state";
import { formatError } from "@/lib/format-error";
import { rememberRecentTarget } from "@/lib/recent-targets";
import { rankedFilter } from "@/features/search/application/rank-filter";
import { RelatedPanel } from "@/components/related-panel";
import { useSearchIndex } from "@/lib/hooks/use-search-index";
import { BacklinksPanel } from "./backlinks-panel";
import { NoteCard, noteBodyText } from "./note-card";
import { PageEditor } from "./page-editor";
import type { VaultViewData } from "./types";

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
      setError(formatError(err));
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

function collectIds(node: VaultPageTreeNode): string[] {
  return [node.page.id, ...node.children.flatMap(collectIds)];
}
