"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { normalizeTitleKey, type VaultPage, type VaultPageSummary } from "@weaveforge/core";
import type { ReadingList } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { ScreenLoading } from "@/components/screen-loading";
import { loadPinnedOwnerNames } from "@/features/sharing/application/load-pinned-owner-names";
import { untitledTitle } from "../../application/untitled-title";
import { importNotesFromFiles } from "../../application/import-notes";
import { loadLinkTargets } from "../../application/load-link-targets";
import { createNoteFromLink as createOrReuseNote } from "../../application/create-note-from-link";
import { logToApp } from "@/lib/error-report/app-log";
import { useScreenData } from "@/lib/hooks/use-screen-data";
import { useDetailBack, useDetailPushFlag } from "@/lib/hooks/use-detail-back";
import { emptyArray, emptyMap, emptySet } from "@/lib/empty";
import { useProject } from "@/features/projects";
import { projectScopedKey, usePersistedState } from "@/lib/hooks/use-persisted-state";
import { formatError } from "@/lib/format-error";
import { rememberRecentTarget } from "@/lib/recent-targets";
import { useScreenSearch } from "@/lib/hooks/use-screen-search";
import { noteBodyText, isHydratedPage } from "./note-card";
import { NoteCardGrid } from "./note-card-grid";
import { noteBacklinks, noteTags, scopeNotes } from "../../application/note-derivations";
import { openNoteBody } from "./open-note-body";
import { PageEditor } from "./page-editor";
import type { VaultViewData } from "./types";
import { FilterRow } from "@/components/filter-row";
import { ClearFiltersButton, EmptyState } from "@/components/empty-state";
import { NavIcon } from "@/app/nav-icon";
import { ScreenHead } from "@/components/screen-head";
import { FormError } from "@/components/form-error";
import { navTransition } from "@/lib/view-transition";
import { Button } from "@/components/button";
import { Popover } from "@/components/popover";
import { Menu } from "@/components/menu";

export function VaultScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("page");
  const isSharedView = searchParams.get("shared") === "1";

  // The note New note just made: it opens with its title focused.
  const [newPageId, setNewPageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const importZipRef = useRef<HTMLInputElement | null>(null);
  const importFolderRef = useRef<HTMLInputElement | null>(null);
  // File inputs stay mounted outside the modal so pickers survive dialog close.
  // Filters name lists and tags of one project, so each project keeps its own.
  const projectId = useProject().current?.id;
  const [listFilter, setListFilter] = usePersistedState<string[]>(projectScopedKey("thesis.notes.list", projectId), []);
  const [tagFilter, setTagFilter] = usePersistedState<string[]>(projectScopedKey("thesis.notes.tags", projectId), []);
  const [search, setSearch] = usePersistedState<string>(projectScopedKey("thesis.notes.search", projectId), "");
  const appliedPageFromUrl = useRef<string | null>(null);
  const { setPushed, consumePushed } = useDetailPushFlag();
  const goBackToList = useDetailBack("/notes", "page", consumePushed);

  const loadScreen = useCallback(async (): Promise<VaultViewData> => {
    const data = await getContainer().vault.loadScreenData();
    const [ownerNames, links] = await Promise.all([
      loadPinnedOwnerNames(data.pinnedSharedBy),
      loadLinkTargets(
        {
          papers: () => getContainer().papers.loadScreenData(),
          sections: () => getContainer().report.loadScreenData(),
        },
        logToApp,
      ),
    ]);
    return {
      ...data,
      ownerNames,
      paperEntries: links.paperEntries,
      sectionEntries: links.sectionEntries,
      linkTargetsError: links.error,
    };
  }, []);

  const { data, loading, error: loadError, reload: load, setData } = useScreenData("vault", loadScreen);

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
  const backlinks = useMemo(() => noteBacklinks(flat, selectedId), [selectedId, flat]);

  const selected = useMemo(
    () => flat.find((p) => p.id === selectedId) ?? null,
    [flat, selectedId],
  );

  // A list reload hands back summaries, and the open note is fetched in full
  // again. Until it lands the note keeps the full page it had, so the editor
  // stays mounted — and its Edit / Read / Ink mode with it — instead of
  // dropping to "Opening note…" and coming back in Read.
  const [heldPage, setHeldPage] = useState<VaultPage | null>(null);
  // Why the selected note could not be opened, shown instead of "Opening note…".
  const [openError, setOpenError] = useState<string | null>(null);
  if (selected && isHydratedPage(selected) && selected !== heldPage) setHeldPage(selected);
  const shownPage: VaultPage | VaultPageSummary | null =
    selected && !isHydratedPage(selected) && heldPage?.id === selected.id ? heldPage : selected;

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
    setOpenError(null);
    void openNoteBody((id) => getContainer().vault.getPage(id), selectedId).then(({ page, error: failed }) => {
      if (cancelled) return;
      if (!page) return setOpenError(failed);
      appliedPageFromUrl.current = selectedId;
      upsertFlatPage(page);
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
    navTransition("forward", () => router.push(`/notes?${params.toString()}`));
  }

  /** New note: an Untitled note, opened, title focused to type over (DA-71). */
  async function createUntitled() {
    setError(null);
    try {
      const page = await getContainer().vault.manageVaultPage.add({
        title: untitledTitle(flat.map((p) => p.title)),
      });
      setNewPageId(page.id);
      await load();
      openPage(page.id);
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function onImportFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
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

  /**
   * An unresolved `[[wikilink]]` creates that note, or reuses one with the same
   * title. A click opens it; a link finished while typing passes `open: false`.
   */
  const createNoteFromLink = useCallback(
    async (title: string, opts?: { open?: boolean }) => {
      try {
        await createOrReuseNote(title, opts, {
          existing: flat,
          add: (t) => getContainer().vault.manageVaultPage.add({ title: t }),
          reload: load,
          open: (id) => {
            const params = new URLSearchParams(searchParams.toString());
            params.set("page", id);
            setPushed();
            router.push(`/notes?${params.toString()}`);
          },
        });
      } catch (err) {
        setError(formatError(err));
      }
    },
    [flat, load, searchParams, setPushed, router],
  );

  const ownedNotes = useMemo(
    () => flat.filter((p) => ownedIds.has(p.id) && !pinnedSharedBy.has(p.id)),
    [flat, ownedIds, pinnedSharedBy],
  );

  const allTags = useMemo(() => noteTags(flat), [flat]);

  const hasNotes = ownedNotes.length > 0 || pinnedPages.length > 0;

  const match = useScreenSearch(search, "note");
  const filterNotes = useCallback(
    (notes: (VaultPageSummary | VaultPage)[]) => {
      // List and tag filters first, so the ranked pass orders only what survives.
      const scoped = scopeNotes(notes, { listFilter, tagFilter, membership });
      return match(scoped, (p) => p.id, (p) => `${p.title}\n${noteBodyText(p)}`);
    },
    [listFilter, tagFilter, membership, match],
  );

  const visibleOwned = useMemo(() => filterNotes(ownedNotes), [ownedNotes, filterNotes]);
  // The owner's pinned notes get their own section above the rest.
  const visibleMine = useMemo(() => visibleOwned.filter((p) => p.pinned), [visibleOwned]);
  const visibleUnpinned = useMemo(() => visibleOwned.filter((p) => !p.pinned), [visibleOwned]);
  const visiblePinned = useMemo(() => filterNotes(pinnedPages), [pinnedPages, filterNotes]);
  const visibleCount = visibleOwned.length + visiblePinned.length;

  if (loading) {
    return <ScreenLoading status="Loading notes…" className="screen vault-screen" />;
  }

  return (
    <section className="screen vault-screen">
      {/* An open note is a record page, as a paper is: its own bar carries
          the way back and its actions, so the list head steps aside. */}
      {!selected && (
      <ScreenHead
        eyebrow={hasNotes ? `${ownedNotes.length} ${ownedNotes.length === 1 ? "note" : "notes"}` : undefined}
        search={hasNotes ? { value: search, onChange: setSearch, label: "Search notes" } : undefined}
      >
        <Button
          variant="primary"
         
          disabled={importing}
          onClick={() => void createUntitled()}
        >
          {importing ? "Importing…" : "New note"}
        </Button>
        {/* Imports and the wiki sit one click away, as on Papers: the wiki
            reads notes *and* papers, so neither screen owns it. */}
        <Popover label="More" ariaLabel="More actions" align="right">
          {(close) => (
            <Menu
              onClose={close}
              items={[
                {
                  id: "import-zip",
                  label: "Import zip…",
                  disabled: importing,
                  title: "A .zip of markdown notes (Obsidian vault, Notion export, …)",
                  onSelect: () => importZipRef.current?.click(),
                },
                {
                  id: "import-folder",
                  label: "Import folder…",
                  disabled: importing,
                  title: "A local folder of markdown notes",
                  onSelect: () => importFolderRef.current?.click(),
                },
                { id: "sep", label: "", kind: "separator" as const },
                { id: "wiki", label: "Wiki", onSelect: () => router.push("/wiki") },
              ]}
            />
          )}
        </Popover>
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
      )}

      {error && <FormError>{error}</FormError>}
      {data?.linkTargetsError && <FormError>{data.linkTargetsError}</FormError>}
      {importMsg && <p className="muted vault-import-msg">{importMsg}</p>}

      {!error && !selected && hasNotes && (
        <FilterRow
          label="Filter notes"
          facets={[
            {
              id: "fnlist",
              label: "Lists",
              chipPrefix: "List: ",
              values: listFilter,
              onChange: setListFilter,
              options: lists.map((l) => ({ value: l.id, label: l.name })),
            },
            {
              id: "fntags",
              label: "Tags",
              values: tagFilter,
              onChange: setTagFilter,
              options: allTags.map((t) => ({ value: t, label: `#${t}` })),
            },
          ]}
        />
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
            {openError && (!shownPage || !isHydratedPage(shownPage)) ? (
              <FormError>{openError}</FormError>
            ) : !shownPage || !isHydratedPage(shownPage) ? (
              <ScreenLoading status="Opening note…" />
            ) : (
              <PageEditor
                page={shownPage}
                readOnly={isReadOnlyPage(shownPage.id)}
                sharedPage={isSharedPage(shownPage.id)}
                sharedByName={sharedOwnerName(shownPage.id)}
                canComment={vaultCanComment.get(shownPage.id) ?? false}
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
                focusTitle={newPageId === shownPage.id}
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
              <Button
                variant="primary"
                onClick={() => void createUntitled()}
              >
                New note
              </Button>
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
          <NoteCardGrid
            mine={visibleMine}
            unpinned={visibleUnpinned}
            shared={visiblePinned}
            isPinned={(id) => pinnedSharedBy.has(id)}
            sharedOwnerName={sharedOwnerName}
            onOpen={openPage}
            onChanged={load}
          />
        )
      )}
    </section>
  );
}

