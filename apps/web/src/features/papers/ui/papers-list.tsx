"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PAPER_STATUSES, type Paper, type PaperSummary, type ReadingList } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { formatError } from "@/lib/format-error";
import { Modal } from "@/components/modal";
import { ScreenLoading } from "@/components/screen-loading";
import { CardsViewIcon, ListViewIcon } from "@/components/view-icons";
import { CardColumns } from "@/components/card-columns";
import { rankedFilter } from "@/features/search/application/rank-filter";
import { useHybridSearchIndex, type WorkspaceSearchFn } from "@/lib/hooks/use-search-index";
import { usePinnedOwnerNames } from "@/features/sharing";
import { AddPaperForm } from "./add-paper-form";
import { MultiSelect } from "@/components/multi-select";
import { usePersistedState } from "@/lib/hooks/use-persisted-state";
import { useScreenData } from "@/lib/hooks/use-screen-data";
import { useDetailBack, useDetailPushFlag } from "@/lib/hooks/use-detail-back";
import { emptyArray, emptyMap } from "@/lib/empty";
import type { PapersScreenData } from "@/features/papers/application/load-papers-screen.use-case";
import { rememberRecentTarget } from "@/lib/recent-targets";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { PaperCard } from "./paper-card";
import { LibraryTidyNotice } from "./library-tidy";
import { PaperNote } from "./paper-note";
import { PapersTable } from "./papers-table";
import { Popover } from "@/components/popover";
import { ClearFiltersButton, EmptyState } from "@/components/empty-state";
import { NavIcon } from "@/app/nav-icon";
import { FormError } from "@/components/form-error";

type PapersViewData = PapersScreenData & { ownerNames: Map<string, string> };

type PapersLayout = "cards" | "list";

/**
 * Papers screen. Presentation + view-state only; all data access goes through
 * the repository obtained from the container.
 */
export function PapersScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  // Resolved after mount: the server has no shell, and disagreeing with it on
  // the first render would be a hydration mismatch.
  const [hasShell, setHasShell] = useState(false);
  const [checkingAlerts, setCheckingAlerts] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<"menu" | "new">("menu");
  const [openId, setOpenId] = useState<string | null>(null);
  const [guestPaper, setGuestPaper] = useState<Paper | null>(null);
  const isSharedView = searchParams.get("shared") === "1";
  const [statusFilter, setStatusFilter] = usePersistedState<string[]>("thesis.papers.status", []);
  const [listFilter, setListFilter] = usePersistedState<string[]>("thesis.papers.list", []);
  const [tagFilter, setTagFilter] = usePersistedState<string[]>("thesis.papers.tags", []);
  const [search, setSearch] = usePersistedState<string>("thesis.papers.search", "");
  const [storedLayout, setLayout] = usePersistedState<PapersLayout>("thesis.papers.view", "cards");
  // A status board used to be a third layout; a reader who last left it on
  // gets the cards.
  const layout: PapersLayout = storedLayout === "list" ? "list" : "cards";
  const { setPushed, consumePushed } = useDetailPushFlag();
  const goBackToList = useDetailBack("/papers", "paper", consumePushed);

  const openPaperById = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("paper", id);
      setPushed();
      router.push(`/papers?${params.toString()}`);
    },
    [router, searchParams, setPushed],
  );

  const loadScreen = useCallback(async (): Promise<PapersViewData> => {
    const data = await getContainer().papers.loadScreenData();
    // Owner labels arrive separately — see usePinnedOwnerNames. Awaiting the
    // lab directory here delayed the whole screen by ~1.8s.
    return { ...data, ownerNames: emptyMap<string, string>() };
  }, []);

  const { data, loading, error: loadError, reload: load, refresh, setData } = useScreenData("papers", loadScreen);
  // Only a typed query ranks through the index; building it for an untouched
  // list would read the whole project on every visit to the screen.
  const { search: keywordSearch, searchHybrid, ready: indexReady } = useHybridSearchIndex(
    search.trim().length > 0,
  );
  // The hybrid answer for the query currently typed, once it arrives. Keyword
  // ranking answers immediately; this replaces it when the semantic arm is on,
  // so a paper found by meaning rather than wording appears here as it does in
  // the jump palette. Tagged with its query so a slow answer to an older one is
  // never applied to a newer one.
  const [hybrid, setHybrid] = useState<{ query: string; hits: ReturnType<WorkspaceSearchFn> } | null>(null);
  useEffect(() => {
    const q = search.trim();
    if (!q || !indexReady) return;
    let live = true;
    void searchHybrid(q, { kinds: ["paper"], limit: 500 }).then((hits) => {
      if (live) setHybrid({ query: q, hits });
    });
    return () => {
      live = false;
    };
  }, [search, indexReady, searchHybrid]);
  const searchIndex = useCallback<WorkspaceSearchFn>(
    (q, options) => (hybrid && hybrid.query === q.trim() ? hybrid.hits : keywordSearch(q, options)),
    [hybrid, keywordSearch],
  );

  usePinnedOwnerNames(data, setData);

  useEffect(() => {
    setError(loadError);
  }, [loadError]);

  useEffect(() => setHasShell(typeof desktop()?.zoteroLocal === "function"), []);

  const papers = data?.papers ?? emptyArray<PaperSummary>();
  const lists = data?.lists ?? emptyArray<ReadingList>();
  const membership = data?.membership ?? emptyMap<string, Set<string>>();
  const pinnedSharedBy = data?.pinnedSharedBy ?? emptyMap<string, string>();
  const paperCanComment = data?.paperCanComment ?? emptyMap<string, boolean>();
  const ownerNames = data?.ownerNames ?? emptyMap<string, string>();
  // Only the reader's own papers are offered for tidying: a pinned paper
  // shared by someone else is theirs to rename or merge.
  const ownPapers = useMemo(
    () => (isSharedView ? emptyArray<PaperSummary>() : papers.filter((p) => !pinnedSharedBy.has(p.id))),
    [papers, pinnedSharedBy, isSharedView],
  );

  const syncZotero = useCallback(async () => {
    setSyncing(true);
    setSyncMsg(null);
    setError(null);
    try {
      const { library, annotations } = await getContainer().zotero.syncBibliography();
      const { pushed, pulled, deletedLocal } = library;
      setSyncMsg(
        `Synced — pushed ${pushed}, pulled ${pulled}, removed ${deletedLocal} · ${annotations} annotations.`,
      );
      await load();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSyncing(false);
    }
  }, [load]);

  /**
   * The Zotero on this machine, rather than the one in the cloud.
   *
   * Only offered in the desktop app, because only the shell can reach a
   * plain-HTTP loopback server. Its items become papers, and those papers
   * gain their annotations; nothing is sent back.
   */
  const importLocalZotero = useCallback(async () => {
    setSyncing(true);
    setSyncMsg(null);
    setError(null);
    try {
      const { papers, annotations, items } = await getContainer().zotero.importLocalZotero();
      setSyncMsg(
        `Read Zotero on this computer — ${papers} new paper${papers === 1 ? "" : "s"}, ${items} annotated item${items === 1 ? "" : "s"}, ${annotations} paper${annotations === 1 ? "" : "s"} updated.`,
      );
      await load();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSyncing(false);
    }
  }, [load]);

  const checkCitationAlerts = useCallback(async () => {
    setCheckingAlerts(true);
    setSyncMsg(null);
    setError(null);
    try {
      const result = await getContainer().papers.checkCitationAlerts(true);
      setSyncMsg(
        result.tracked === 0
          ? // Saying "nothing is tracked" without saying how to track anything
            // leaves the user stuck. Name the control that turns it on.
            "No papers are tracked yet — open a paper and use the bell icon to watch it for new citations."
          : `Checked ${result.checked} tracked paper${result.checked === 1 ? "" : "s"} — ${result.found} new citation${result.found === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      setError(formatError(err));
    } finally {
      setCheckingAlerts(false);
    }
  }, []);

  const replace = useCallback(
    (p: Paper) => {
      setData((prev) =>
        prev ? { ...prev, papers: prev.papers.map((x) => (x.id === p.id ? p : x)) } : prev,
      );
      setGuestPaper((g) => (g?.id === p.id ? p : g));
    },
    [setData],
  );

  const paperFromUrl = searchParams.get("paper");
  const appliedPaperFromUrl = useRef<string | null>(null);
  const paperOpenGeneration = useRef(0);
  /**
   * Which paper `guestPaper` currently holds, readable from inside the effect
   * below without adding it to that effect's dependency list — re-running the
   * fetch every time the hydrated paper changes is what the generation counter
   * above exists to prevent.
   */
  const guestPaperIdRef = useRef<string | null>(null);
  guestPaperIdRef.current = guestPaper?.id ?? null;
  const listPaperStamp = paperFromUrl
    ? papers.find((p) => p.id === paperFromUrl)?.updatedAt ?? "missing"
    : null;
  useEffect(() => {
    if (!paperFromUrl) {
      appliedPaperFromUrl.current = null;
      setGuestPaper(null);
      setOpenId(null);
      return;
    }
    const owned = papers.some((p) => p.id === paperFromUrl);
    const shared = isSharedView || pinnedSharedBy.has(paperFromUrl);
    if (!owned && !shared) {
      appliedPaperFromUrl.current = null;
      setGuestPaper(null);
      setOpenId(null);
      return;
    }
    // Re-hydrate when list stamp changes (e.g. Zotero sync) so annotations refresh.
    const appliedKey = `${paperFromUrl}:${listPaperStamp ?? ""}`;
    if (appliedPaperFromUrl.current === appliedKey) {
      setOpenId(paperFromUrl);
      return;
    }
    const requestedId = paperFromUrl;
    const generation = ++paperOpenGeneration.current;
    let cancelled = false;
    // A paper we cannot re-read is either already hydrated on screen or it is
    // not; both the "not found" and the "read failed" paths answer that the same
    // way, so they ask here rather than each spelling it out. The ref (not the
    // state) is what makes the answer the value at the moment the response
    // lands, rather than the one captured when the effect started.
    const keepOrDrop = () => {
      const keepHydrated = guestPaperIdRef.current === requestedId;
      if (!keepHydrated) setGuestPaper(null);
      appliedPaperFromUrl.current = appliedKey;
      // Close the view when nothing hydrated is left to open. Leaving `openId`
      // set is what would strand the screen on "Opening paper…": the list still
      // holds the row, so `papers.some(...)` alone cannot tell the difference.
      setOpenId((cur) => (cur !== requestedId ? cur : keepHydrated ? cur : null));
    };
    setOpenId(requestedId);
    void getContainer()
      .papers.getPaper(requestedId)
      .then((p) => {
        if (cancelled || generation !== paperOpenGeneration.current) return;
        if (!p) {
          // No hydrated row to show, and the list's summary is not a paper the
          // note page can render — so this either keeps the paper already on
          // screen or closes the view.
          keepOrDrop();
          return;
        }
        appliedPaperFromUrl.current = appliedKey;
        setGuestPaper(p);
        setOpenId(requestedId);
      })
      .catch(() => {
        if (cancelled || generation !== paperOpenGeneration.current) return;
        // Transient rehydrate failure must not kick the user out after a save —
        // `keepOrDrop` keeps the view open whenever the hydrated paper is still
        // in hand, which is exactly the post-save case.
        keepOrDrop();
      });
    return () => {
      cancelled = true;
    };
  }, [paperFromUrl, papers, isSharedView, pinnedSharedBy, listPaperStamp]);

  const closePaper = useCallback(() => {
    paperOpenGeneration.current += 1;
    setOpenId(null);
    setGuestPaper(null);
    appliedPaperFromUrl.current = null;
    goBackToList();
  }, [goBackToList]);

  const sharedOwnerName = useCallback(
    (paperId: string) => {
      const ownerId = pinnedSharedBy.get(paperId);
      return ownerId ? ownerNames.get(ownerId) : undefined;
    },
    [pinnedSharedBy, ownerNames],
  );

  const isReadOnlyPaper = useCallback(
    (paperId: string) => isSharedView || pinnedSharedBy.has(paperId),
    [isSharedView, pinnedSharedBy],
  );

  const readCount = papers.filter((p) => p.status === "read").length;
  const pct = papers.length ? Math.round((readCount / papers.length) * 100) : 0;
  const activeFilters =
    (statusFilter.length ? 1 : 0) + (listFilter.length ? 1 : 0) + (tagFilter.length ? 1 : 0);

  // Every distinct tag across the library (for the tag filter dropdown).
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const p of papers) for (const t of p.tags) set.add(t);
    return [...set].sort();
  }, [papers]);

  const visible = useMemo(() => {
    const statuses = new Set(statusFilter);
    const inAnyList = (id: string) =>
      listFilter.some((lid) => membership.get(lid)?.has(id) ?? false);
    const hasAnyTag = (p: PaperSummary) => tagFilter.some((t) => p.tags.includes(t));
    // Facet filters first; the ranked pass then orders what survives them.
    const scoped = papers.filter(
      (p) =>
        (statuses.size === 0 || statuses.has(p.status)) &&
        (listFilter.length === 0 || inAnyList(p.id)) &&
        (tagFilter.length === 0 || hasAnyTag(p)),
    );
    // Now also matches on abstract, summary, venue, and identifiers — not just
    // title and author.
    return rankedFilter({
      items: scoped,
      query: search,
      kinds: ["paper"],
      search: searchIndex,
      idOf: (p) => p.id,
      fallbackText: (p) => `${p.title}\n${p.authors.join(" ")}`,
    });
  }, [papers, statusFilter, listFilter, tagFilter, membership, search, searchIndex]);

  /*
   * The open paper must be the hydrated row, never the list's summary.
   *
   * The list holds the summary projection, and `PaperNote` genuinely needs the
   * full paper: it reads `paper.metadata` for the cite key, offers the delete
   * that clears that metadata, and seeds its editor from the note text. Falling
   * back to `papers.find(...)` handed it a projection with no `metadata` — a
   * `Paper` by type and not one in fact, which is the class of bug review-2 F6
   * is about. The effect above loads the real row; until it lands the screen
   * keeps a loading state rather than rendering the note against a projection.
   */
  const openPaper = openId && guestPaper?.id === openId ? guestPaper : null;

  useEffect(() => {
    if (!openPaper) return;
    rememberRecentTarget(getContainer().projects.context.projectId, {
      kind: "paper",
      id: openPaper.id,
      title: openPaper.title,
      href: `/papers?paper=${encodeURIComponent(openPaper.id)}`,
    });
  }, [openPaper]);

  // Full-page reading view for a single paper's note.
  if (openPaper) {
    const readOnly = isReadOnlyPaper(openPaper.id);
    return (
      <section className="screen">
        <PaperNote
          key={openPaper.id}
          paper={openPaper}
          readOnly={readOnly}
          sharedByName={sharedOwnerName(openPaper.id)}
          canComment={paperCanComment.get(openPaper.id) ?? false}
          onBack={closePaper}
          onReplace={replace}
          onChanged={() => { closePaper(); void load(); }}
        />
      </section>
    );
  }

  if (loading) {
    return <ScreenLoading status="Loading papers…" />;
  }

  // A paper is open but not hydrated yet. `keepOrDrop` below resolves this to
  // either a hydrated paper or a closed view, so this is the in-flight frame
  // rather than a state the screen can settle in.
  if (openId) {
    return <ScreenLoading status="Opening paper…" />;
  }

  return (
    <section className="screen papers-screen">
      {/* The screen's own header, not the shared `ScreenHead`: the library is
          the one list screen with enough controls to need a hierarchy. Where you
          are and how far through it you are on the left; the two things you do
          most (find, add) on the right; the occasional actions behind "More". */}
      <header className="screen-head papers-head">
        <div className="papers-head-row">
          <div className="papers-head-title">
            <h1 className="screen-title">Papers</h1>
            {papers.length > 0 && (
              <div className="papers-ledger">
                <span>
                  {papers.length} {papers.length === 1 ? "paper" : "papers"} · {readCount} read
                </span>
                <span
                  className="papers-ledger-bar"
                  role="progressbar"
                  aria-label="Reading progress"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span style={{ width: `${pct}%` }} />
                </span>
                <span>{pct}%</span>
              </div>
            )}
          </div>
          <div className="papers-head-actions">
            {papers.length > 0 && (
              <input
                className="search-input"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search papers"
                aria-label="Search papers"
              />
            )}
            <button
              className="btn-primary"
              type="button"
              disabled={syncing}
              onClick={() => { setComposeMode("menu"); setComposeOpen(true); }}
            >
              {syncing ? "Syncing…" : "Add paper"}
            </button>
            {/* The wiki reads the papers and notes together and proposes pages;
                the citation check looks for new work citing the library. Both
                are occasional, so they sit one click away rather than beside
                Add paper. */}
            <Popover label="More" ariaLabel="More actions" align="right">
              {(close) => (
                <ul className="card-menu-list">
                  <li>
                    <button
                      type="button"
                      className="card-menu-item"
                      onClick={() => { close(); router.push("/wiki"); }}
                    >
                      Wiki
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="card-menu-item"
                      disabled={checkingAlerts}
                      onClick={() => { close(); void checkCitationAlerts(); }}
                    >
                      {checkingAlerts ? "Checking citations…" : "Check citations"}
                    </button>
                  </li>
                </ul>
              )}
            </Popover>
          </div>
        </div>
        {syncMsg && <p className="muted">{syncMsg}</p>}
      </header>

      {composeOpen && (
        <Modal
          title={composeMode === "new" ? "Add a paper" : "Add papers"}
          onClose={() => { setComposeOpen(false); setComposeMode("menu"); }}
        >
          {composeMode === "menu" ? (
            <div className="org-modal-choices">
              <button
                type="button"
                className="org-choice-card"
                onClick={() => setComposeMode("new")}
              >
                <span className="org-choice-title">Add paper</span>
                <p className="org-choice-desc">Create a paper entry manually or from a URL.</p>
              </button>
              <button
                type="button"
                className="org-choice-card"
                disabled={syncing}
                onClick={() => {
                  setComposeOpen(false);
                  setComposeMode("menu");
                  void syncZotero();
                }}
              >
                <span className="org-choice-title">Sync Zotero</span>
                <p className="org-choice-desc">Pull papers from your linked Zotero library.</p>
              </button>
              {hasShell && (
                <button
                  type="button"
                  className="org-choice-card"
                  disabled={syncing}
                  onClick={() => {
                    setComposeOpen(false);
                    setComposeMode("menu");
                    void importLocalZotero();
                  }}
                >
                  <span className="org-choice-title">Read Zotero on this computer</span>
                  <p className="org-choice-desc">
                    Import annotations from the running Zotero. No API key, and nothing is written
                    back.
                  </p>
                </button>
              )}
            </div>
          ) : (
            <AddPaperForm
              onAdded={() => {
                setComposeOpen(false);
                setComposeMode("menu");
                void load();
              }}
            />
          )}
        </Modal>
      )}

      {papers.length > 0 && (
        <div className="papers-filters" role="group" aria-label="Filter papers">
          <MultiSelect
            id="fstatus"
            className="papers-filter"
            values={statusFilter}
            onChange={setStatusFilter}
            allLabel="Status"
            ariaLabel="Filter by status"
            options={PAPER_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
          />
          {lists.length > 0 && (
            <MultiSelect
              id="flist"
              className="papers-filter"
              values={listFilter}
              onChange={setListFilter}
              allLabel="Lists"
              ariaLabel="Filter by list"
              options={lists.map((l) => ({ value: l.id, label: l.name }))}
            />
          )}
          {allTags.length > 0 && (
            <MultiSelect
              id="ftags"
              className="papers-filter"
              values={tagFilter}
              onChange={setTagFilter}
              allLabel="Tags"
              ariaLabel="Filter by tags"
              options={allTags.map((t) => ({ value: t, label: `#${t}` }))}
            />
          )}
          {statusFilter.map((v) => (
            <FilterChip
              key={`s:${v}`}
              label={`Status: ${statusLabel(v)}`}
              onRemove={() => setStatusFilter(statusFilter.filter((x) => x !== v))}
            />
          ))}
          {listFilter.map((v) => (
            <FilterChip
              key={`l:${v}`}
              label={`List: ${lists.find((l) => l.id === v)?.name ?? "removed list"}`}
              onRemove={() => setListFilter(listFilter.filter((x) => x !== v))}
            />
          ))}
          {tagFilter.map((v) => (
            <FilterChip
              key={`t:${v}`}
              label={`#${v}`}
              onRemove={() => setTagFilter(tagFilter.filter((x) => x !== v))}
            />
          ))}
          {activeFilters > 0 && (
            <button
              type="button"
              className="link-btn"
              onClick={() => { setStatusFilter([]); setListFilter([]); setTagFilter([]); }}
            >
              Clear
            </button>
          )}
          <div className="seg papers-layout-seg" role="tablist" aria-label="Papers layout">
            <button
              type="button"
              role="tab"
              aria-selected={layout === "cards"}
              className={layout === "cards" ? "seg-on" : ""}
              onClick={() => setLayout("cards")}
            >
              <CardsViewIcon />
              Cards
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={layout === "list"}
              className={layout === "list" ? "seg-on" : ""}
              onClick={() => setLayout("list")}
            >
              <ListViewIcon />
              List
            </button>
          </div>
        </div>
      )}

      <LibraryTidyNotice papers={ownPapers} onChanged={refresh} />

      {error && <FormError>{error}</FormError>}
      {!error && papers.length === 0 && (
        <EmptyState
          variant="first-run"
          icon={<NavIcon name="book" />}
          title="No papers yet"
          body="Everything in WeaveForge hangs off a paper: the notes you take on it, the runs it inspired, the section it ends up in. Add your first one and the rest has somewhere to attach."
          action={
            <button
              type="button"
              className="btn-primary"
              onClick={() => { setComposeMode("menu"); setComposeOpen(true); }}
            >
              Add paper
            </button>
          }
        />
      )}
      {!error && papers.length > 0 && visible.length === 0 && (
        <EmptyState
          variant="no-results"
          body="No papers match the filter."
          action={
            <ClearFiltersButton
              onClear={() => {
                setSearch("");
                setStatusFilter([]);
                setListFilter([]);
                setTagFilter([]);
              }}
            />
          }
        />
      )}

      {visible.length > 0 && layout === "list" && (
        <PapersTable
          papers={visible}
          isReadOnly={isReadOnlyPaper}
          sharedOwnerName={sharedOwnerName}
          onOpen={openPaperById}
          onReplace={replace}
        />
      )}

      {visible.length > 0 && layout === "cards" && (
        <CardColumns
          items={visible}
          getKey={(p) => p.id}
          deferOffscreen={visible.length > 20}
          renderItem={(p) => (
            <PaperCard
              paper={p}
              readOnly={isReadOnlyPaper(p.id)}
              sharedByName={sharedOwnerName(p.id)}
              onOpen={() => openPaperById(p.id)}
              onReplace={replace}
              onChanged={load}
            />
          )}
        />
      )}

    </section>
  );
}

function statusLabel(status: string): string {
  const words = status.replace("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One active filter, removable on its own. */
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="filter-chip">
      {label}
      <button type="button" className="filter-chip-x" aria-label={`Remove filter ${label}`} onClick={onRemove}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </span>
  );
}
