"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PAPER_STATUSES, type Paper, type ReadingList } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { formatError } from "@/lib/format-error";
import { Modal } from "@/components/modal";
import { ScreenLoading } from "@/components/screen-loading";
import { BoardViewIcon, CardsViewIcon, ListViewIcon } from "@/components/view-icons";
import { CardColumns } from "@/components/card-columns";
import { rankedFilter } from "@/features/search/application/rank-filter";
import { useSearchIndex } from "@/lib/hooks/use-search-index";
import { usePinnedOwnerNames } from "@/features/sharing";
import { AddPaperForm } from "./add-paper-form";
import { MultiSelect } from "@/components/multi-select";
import { usePersistedState } from "@/lib/hooks/use-persisted-state";
import { useScreenData } from "@/lib/hooks/use-screen-data";
import { useDetailBack, useDetailPushFlag } from "@/lib/hooks/use-detail-back";
import { emptyArray, emptyMap } from "@/lib/empty";
import type { PapersScreenData } from "@/features/papers/application/load-papers-screen.use-case";
import { rememberRecentTarget } from "@/lib/recent-targets";
import { PaperCard } from "./paper-card";
import { PaperNote } from "./paper-note";
import { PapersTable } from "./papers-table";
import { ListTagFilters } from "@/components/list-tag-filters";

type PapersViewData = PapersScreenData & { ownerNames: Map<string, string> };

type PapersLayout = "cards" | "list" | "board";

/**
 * Papers screen. Presentation + view-state only; all data access goes through
 * the repository obtained from the container.
 */
export function PapersScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
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
  const [layout, setLayout] = usePersistedState<PapersLayout>("thesis.papers.view", "cards");
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

  const { data, loading, error: loadError, reload: load, setData } = useScreenData("papers", loadScreen);
  // Only a typed query ranks through the index; building it for an untouched
  // list would read the whole project on every visit to the screen.
  const searchIndex = useSearchIndex(search.trim().length > 0);

  usePinnedOwnerNames(data, setData);

  useEffect(() => {
    setError(loadError);
  }, [loadError]);

  const papers = data?.papers ?? emptyArray<Paper>();
  const lists = data?.lists ?? emptyArray<ReadingList>();
  const membership = data?.membership ?? emptyMap<string, Set<string>>();
  const pinnedSharedBy = data?.pinnedSharedBy ?? emptyMap<string, string>();
  const paperCanComment = data?.paperCanComment ?? emptyMap<string, boolean>();
  const ownerNames = data?.ownerNames ?? emptyMap<string, string>();

  const syncZotero = useCallback(async () => {
    setSyncing(true);
    setSyncMsg(null);
    setError(null);
    try {
      const { library, annotations } = await getContainer().papers.syncBibliography();
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
    setOpenId(requestedId);
    void getContainer()
      .papers.getPaper(requestedId)
      .then((p) => {
        if (cancelled || generation !== paperOpenGeneration.current) return;
        if (!p) {
          // Keep an already-open hydrated paper; otherwise fall back to list summary.
          setGuestPaper((g) => (g?.id === requestedId ? g : null));
          appliedPaperFromUrl.current = appliedKey;
          setOpenId((cur) =>
            cur === requestedId && (papers.some((row) => row.id === requestedId) || shared)
              ? cur
              : cur === requestedId
                ? null
                : cur,
          );
          return;
        }
        appliedPaperFromUrl.current = appliedKey;
        setGuestPaper(p);
        setOpenId(requestedId);
      })
      .catch(() => {
        if (cancelled || generation !== paperOpenGeneration.current) return;
        // Transient rehydrate failure must not kick the user out after a save.
        setGuestPaper((g) => (g?.id === requestedId ? g : null));
        appliedPaperFromUrl.current = appliedKey;
        setOpenId((cur) =>
          cur === requestedId && (papers.some((row) => row.id === requestedId) || shared)
            ? cur
            : cur === requestedId
              ? null
              : cur,
        );
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
    const hasAnyTag = (p: Paper) => tagFilter.some((t) => p.tags.includes(t));
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

  const openPaper = openId
    ? (guestPaper?.id === openId ? guestPaper : null) ??
      papers.find((p) => p.id === openId) ??
      null
    : null;

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

  return (
    <section className="screen">
      <header className="screen-head">
        <div className="head-row">
          <div className="screen-actions">
            <button
              className="btn-primary"
              type="button"
              disabled={syncing}
              onClick={() => { setComposeMode("menu"); setComposeOpen(true); }}
            >
              {syncing ? "Syncing…" : "+ Paper"}
            </button>
            <button
              className="btn-secondary"
              type="button"
              disabled={checkingAlerts}
              onClick={() => void checkCitationAlerts()}
            >
              {checkingAlerts ? "Checking…" : "Check citations"}
            </button>
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
        <div className="card progress-card">
          <div className="progress-top">
            <span>{readCount} / {papers.length} papers read</span>
            <strong>{pct}%</strong>
          </div>
          <div
            className="progress-bar"
            role="progressbar"
            aria-label="Reading progress"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {papers.length > 0 && (
        <div className="papers-controls">
          <div className="papers-controls-main">
            <input
              className="search-input"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title or author…"
              aria-label="Search papers"
            />
            <ListTagFilters
              idPrefix="f"
              lists={lists}
              listFilter={listFilter}
              onListFilter={setListFilter}
              allTags={allTags}
              tagFilter={tagFilter}
              onTagFilter={setTagFilter}
              activeFilters={activeFilters}
              onClear={() => { setStatusFilter([]); setListFilter([]); setTagFilter([]); }}
            >
              <MultiSelect
                id="fstatus"
                values={statusFilter}
                onChange={setStatusFilter}
                allLabel="All statuses"
                ariaLabel="Filter by status"
                options={PAPER_STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") }))}
              />
            </ListTagFilters>
            <div className="seg" role="tablist" aria-label="Papers layout">
              <button
                type="button"
                role="tab"
                aria-label="Cards view"
                aria-selected={layout === "cards"}
                className={layout === "cards" ? "seg-on" : ""}
                onClick={() => setLayout("cards")}
              >
                <CardsViewIcon />
              </button>
              <button
                type="button"
                role="tab"
                aria-label="List view"
                aria-selected={layout === "list"}
                className={layout === "list" ? "seg-on" : ""}
                onClick={() => setLayout("list")}
              >
                <ListViewIcon />
              </button>
              <button
                type="button"
                role="tab"
                aria-label="Board by status"
                aria-selected={layout === "board"}
                className={layout === "board" ? "seg-on" : ""}
                onClick={() => setLayout("board")}
              >
                <BoardViewIcon />
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {!error && papers.length === 0 && (
        <div className="empty">
          <p>No papers yet. Use “+ Paper” to add your first one.</p>
        </div>
      )}
      {!error && papers.length > 0 && visible.length === 0 && (
        <div className="empty">
          <p>No papers match the filter.</p>
        </div>
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

      {visible.length > 0 && layout === "board" && (
        <div className="papers-board">
          {PAPER_STATUSES.map((status) => {
            const col = visible.filter((p) => p.status === status);
            return (
              <div key={status} className="papers-board-col">
                <h3>
                  {status.replace("_", " ")} · {col.length}
                </h3>
                {col.map((p) => (
                  <PaperCard
                    key={p.id}
                    paper={p}
                    readOnly={isReadOnlyPaper(p.id)}
                    sharedByName={sharedOwnerName(p.id)}
                    onOpen={() => openPaperById(p.id)}
                    onReplace={replace}
                    onChanged={load}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
