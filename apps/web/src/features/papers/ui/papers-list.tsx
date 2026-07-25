"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  PAPER_STATUSES,
  PAPER_FIELD_KINDS,
  computeRollup,
  type Paper,
  type PaperFieldDef,
  type PaperFieldKind,
  type PaperFieldRollupAgg,
  type PaperFieldValue,
  type PaperFieldValueData,
  type PaperStatus,
  type ReadingList,
} from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { formatError } from "@/lib/format-error";
import { Modal } from "@/components/modal";
import { ScreenLoading } from "@/components/screen-loading";
import { Popover } from "@/components/popover";
import {
  BellIcon,
  CardsViewIcon,
  DeleteIcon,
  EditIcon,
  FilterIcon,
  ImageIcon,
  ListViewIcon,
  OpenIcon,
} from "@/components/view-icons";
import { EntityCard } from "@/components/entity-card";
import { ShareButton, CommentsToggle, PinnedPaperBadge } from "@/features/sharing";
import { loadPinnedOwnerNames } from "@/features/sharing/application/load-pinned-owner-names";
import { AddPaperForm } from "./add-paper-form";
import { PaperMarkdown } from "./paper-markdown";
import { paperImageMarkdown, materializePaperBlobImages } from "../lib/paper-images-md";
import { removeHashtagFromBody, reconcileTagsFromBody } from "../lib/note-tags";
import { compressImage } from "@/lib/image-compress";
import { Select } from "@/components/select";
import { MarkdownCodeEditor } from "@/components/markdown-code-editor-lazy";
import { MultiSelect } from "@/components/multi-select";
import { usePersistedState } from "@/lib/use-persisted-state";
import { useScreenData } from "@/lib/use-screen-data";
import { useDetailBack, useDetailPushFlag } from "@/lib/use-detail-back";
import { emptyArray, emptyMap } from "@/lib/empty";
import { useCiteLinkCatalog } from "@/lib/use-cite-links";
import { formatQuoteCiteClipboard } from "@/features/papers/application/sync-annotation-excerpts";
import type { PapersScreenData } from "@/features/papers/application/load-papers-screen.use-case";
import { PaperExternalLink, paperExternalLink } from "./paper-external-link";
import { rememberRecentTarget } from "@/lib/recent-targets";

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
    const ownerNames = await loadPinnedOwnerNames(data.pinnedSharedBy);
    return { ...data, ownerNames };
  }, []);

  const { data, loading, error: loadError, reload: load, setData } = useScreenData("papers", loadScreen);

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
      setError(err instanceof Error ? err.message : String(err));
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
          ? "No citation alerts are tracked yet."
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
    },
    [setData],
  );

  const paperFromUrl = searchParams.get("paper");
  const appliedPaperFromUrl = useRef<string | null>(null);
  useEffect(() => {
    if (!paperFromUrl) {
      appliedPaperFromUrl.current = null;
      setGuestPaper(null);
      setOpenId(null);
      return;
    }
    if (appliedPaperFromUrl.current === paperFromUrl) return;
    if (papers.some((p) => p.id === paperFromUrl)) {
      appliedPaperFromUrl.current = paperFromUrl;
      setOpenId(paperFromUrl);
      return;
    }
    if (isSharedView || pinnedSharedBy.has(paperFromUrl)) {
      void getContainer()
        .papers.getPaper(paperFromUrl)
        .then((p) => {
          if (!p) return;
          appliedPaperFromUrl.current = paperFromUrl;
          setGuestPaper(p);
          setOpenId(paperFromUrl);
        });
    }
  }, [paperFromUrl, papers, isSharedView, pinnedSharedBy]);

  const closePaper = useCallback(() => {
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
    const q = search.trim().toLowerCase();
    const statuses = new Set(statusFilter);
    const inAnyList = (id: string) =>
      listFilter.some((lid) => membership.get(lid)?.has(id) ?? false);
    const hasAnyTag = (p: Paper) => tagFilter.some((t) => p.tags.includes(t));
    return papers.filter(
      (p) =>
        (statuses.size === 0 || statuses.has(p.status)) &&
        (listFilter.length === 0 || inAnyList(p.id)) &&
        (tagFilter.length === 0 || hasAnyTag(p)) &&
        (!q ||
          p.title.toLowerCase().includes(q) ||
          p.authors.some((a) => a.toLowerCase().includes(q))),
    );
  }, [papers, statusFilter, listFilter, tagFilter, membership, search]);

  const openPaper = openId
    ? papers.find((p) => p.id === openId) ?? (guestPaper?.id === openId ? guestPaper : null)
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
            <Popover
              label={<FilterIcon />}
              ariaLabel="Filters"
              iconOnly
              count={activeFilters}
              align="right"
            >
              <div className="filters">
                <MultiSelect
                  id="fstatus"
                  values={statusFilter}
                  onChange={setStatusFilter}
                  allLabel="All statuses"
                  ariaLabel="Filter by status"
                  options={PAPER_STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") }))}
                />
                {lists.length > 0 && (
                  <MultiSelect
                    id="flist"
                    values={listFilter}
                    onChange={setListFilter}
                    allLabel="All lists"
                    ariaLabel="Filter by list"
                    options={lists.map((l) => ({ value: l.id, label: l.name }))}
                  />
                )}
                {allTags.length > 0 && (
                  <MultiSelect
                    id="ftags"
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
                    onClick={() => { setStatusFilter([]); setListFilter([]); setTagFilter([]); }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </Popover>
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
                Board
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
        <div className={`paper-grid${visible.length > 20 ? " long-list" : ""}`}>
          {visible.map((p) => (
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

/** Tabular list — same chrome as experiments Compare (`cmp-table`). */
function PapersTable({
  papers,
  isReadOnly,
  sharedOwnerName,
  onOpen,
  onReplace,
}: {
  papers: readonly Paper[];
  isReadOnly: (id: string) => boolean;
  sharedOwnerName: (id: string) => string | undefined;
  onOpen: (id: string) => void;
  onReplace: (p: Paper) => void;
}) {
  type SortKey = "title" | "authors" | "year" | "status";
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "year" ? "desc" : "asc");
    }
  }

  const rows = useMemo(() => {
    const list = [...papers];
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (sortKey === "title") {
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) * dir;
      }
      if (sortKey === "authors") {
        const aa = a.authors[0] ?? "";
        const bb = b.authors[0] ?? "";
        return aa.localeCompare(bb, undefined, { sensitivity: "base" }) * dir;
      }
      if (sortKey === "year") {
        const ay = a.year ?? (sortDir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
        const by = b.year ?? (sortDir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
        return (ay - by) * dir;
      }
      const ai = PAPER_STATUSES.indexOf(a.status);
      const bi = PAPER_STATUSES.indexOf(b.status);
      return (ai - bi) * dir;
    });
    return list;
  }, [papers, sortKey, sortDir]);

  function sortLabel(key: SortKey, label: string) {
    const active = sortKey === key;
    return (
      <button
        type="button"
        className={`link-btn papers-sort-btn${active ? " papers-sort-btn--on" : ""}`}
        onClick={() => toggleSort(key)}
        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      >
        {label}
        <span className="papers-sort-arrow" aria-hidden>
          {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    );
  }

  return (
    <div className="table-scroll papers-table-scroll">
      <table className="cmp-table papers-table">
        <thead>
          <tr>
            <th className="papers-col-title">{sortLabel("title", "Title")}</th>
            <th className="papers-col-authors">{sortLabel("authors", "Authors")}</th>
            <th className="papers-col-year">{sortLabel("year", "Year")}</th>
            <th className="papers-col-status">{sortLabel("status", "Status")}</th>
            <th className="papers-col-link">Link</th>
            <th className="papers-col-open" aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {rows.map((paper) => (
            <PaperTableRow
              key={paper.id}
              paper={paper}
              readOnly={isReadOnly(paper.id)}
              sharedByName={sharedOwnerName(paper.id)}
              onOpen={() => onOpen(paper.id)}
              onReplace={onReplace}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaperTableRow({
  paper,
  readOnly,
  sharedByName,
  onOpen,
  onReplace,
}: {
  paper: Paper;
  readOnly: boolean;
  sharedByName?: string;
  onOpen: () => void;
  onReplace: (p: Paper) => void;
}) {
  const [busy, setBusy] = useState(false);
  const link = paperExternalLink(paper);
  const authors =
    paper.authors.length === 0
      ? "—"
      : paper.authors.length === 1
        ? paper.authors[0]!
        : `${paper.authors[0]} et al.`;

  async function changeStatus(status: PaperStatus) {
    setBusy(true);
    try {
      onReplace(await getContainer().papers.updatePaper.setStatus(paper.id, status));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td className="papers-col-title">
        <button
          type="button"
          className="link-btn papers-table-title-btn"
          onClick={onOpen}
          title={paper.title}
        >
          {paper.title}
        </button>
        {readOnly && sharedByName && (
          <span className="muted papers-table-shared">Shared by {sharedByName}</span>
        )}
      </td>
      <td className="papers-col-authors" title={paper.authors.join(", ") || undefined}>
        {authors}
      </td>
      <td className="papers-col-year">{paper.year ?? "—"}</td>
      <td className="papers-col-status">
        {readOnly ? (
          <span className="muted">{paper.status.replace("_", " ")}</span>
        ) : (
          <Select
            className="status-select"
            value={paper.status}
            disabled={busy}
            onChange={(e) => void changeStatus(e.target.value as PaperStatus)}
            aria-label={`Status for ${paper.title}`}
          >
            {PAPER_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </Select>
        )}
      </td>
      <td className="papers-col-link">
        {link ? (
          <a href={link.href} target="_blank" rel="noreferrer" className="link-btn" title={link.label}>
            <span className="papers-link-full">{link.label} ↗</span>
            <span className="papers-link-short" aria-hidden>↗</span>
          </a>
        ) : (
          "—"
        )}
      </td>
      <td className="papers-col-open">
        <button
          type="button"
          className="entity-icon-btn paper-open-icon"
          onClick={onOpen}
          aria-label={`Open note for ${paper.title}`}
          title="Open note"
        >
          <OpenIcon />
        </button>
      </td>
    </tr>
  );
}

/** Plain-text card preview (~50–100 chars) of a paper note. */
function paperNoteSnippet(body: string, max = 100): string {
  const text = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text === "No summary yet.") return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Compact paper card in the grid; clicking opens the full note page. */
function PaperCard({
  paper,
  readOnly = false,
  sharedByName,
  onOpen,
  onReplace,
  onChanged,
}: {
  paper: Paper;
  readOnly?: boolean;
  sharedByName?: string;
  onOpen: () => void;
  onReplace: (p: Paper) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function changeStatus(status: PaperStatus) {
    setBusy(true);
    try {
      onReplace(await getContainer().papers.updatePaper.setStatus(paper.id, status));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove "${paper.title}"? This also deletes its list memberships and graph edges.`)) return;
    setBusy(true);
    try {
      await getContainer().papers.deletePaper(paper);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const authorsLine =
    paper.authors.length > 0
      ? `${paper.authors.slice(0, 3).join(", ")}${paper.authors.length > 3 ? " et al." : ""}`
      : "";

  const metaBits = [
    authorsLine || null,
    paper.year != null ? String(paper.year) : null,
  ].filter(Boolean) as string[];

  const snippet = paperNoteSnippet(paper.summary ?? "");

  return (
    <EntityCard
      className="paper-card"
      onActivate={onOpen}
      title={paper.title}
      status={
        readOnly ? (
          <PinnedPaperBadge ownerName={sharedByName} />
        ) : (
          <Select
            className="status-select"
            value={paper.status}
            disabled={busy}
            onChange={(e) => void changeStatus(e.target.value as PaperStatus)}
            aria-label="Reading status"
          >
            {PAPER_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </Select>
        )
      }
      meta={metaBits.length > 0 ? metaBits.join(" · ") : undefined}
      tags={paper.tags}
      onDelete={readOnly ? undefined : () => void remove()}
      deleteDisabled={busy}
      deleteAriaLabel="Delete paper"
      actions={
        !readOnly ? (
          <ShareButton resourceType="paper" resourceId={paper.id} title={`Share: ${paper.title}`} />
        ) : undefined
      }
      onOpen={onOpen}
      openLabel="Open note"
    >
      {snippet ? <p className="entity-card-snippet">{snippet}</p> : null}
    </EntityCard>
  );
}

/** Full-page reading view for one paper: the note as an article, plus tags,
 *  annotations, figures, and an inline note editor. */
function PaperNote({
  paper,
  readOnly = false,
  sharedByName,
  canComment = false,
  onBack,
  onReplace,
  onChanged,
}: {
  paper: Paper;
  readOnly?: boolean;
  sharedByName?: string;
  canComment?: boolean;
  onBack: () => void;
  onReplace: (p: Paper) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(paper.summary ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [trackingCitations, setTrackingCitations] = useState<boolean | null>(null);
  const [trackingBusy, setTrackingBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { titles: wikilinkTitles, completions: wikilinkCompletions } = useCiteLinkCatalog();

  useEffect(() => { if (!editing) setDraft(paper.summary ?? ""); }, [paper.summary, editing]);
  useEffect(() => {
    let cancelled = false;
    setTrackingCitations(null);
    void getContainer().papers.isCitationTracking(paper.id).then((enabled) => {
      if (!cancelled) setTrackingCitations(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, [paper.id]);
  const dirty = draft.trim() !== (paper.summary ?? "");
  const hasSummary = !!paper.summary && paper.summary !== "No summary yet.";
  const canTrackCitations = Boolean(paper.doi || paper.arxivId);

  async function changeStatus(status: PaperStatus) {
    setBusy(true);
    try { onReplace(await getContainer().papers.updatePaper.setStatus(paper.id, status)); }
    finally { setBusy(false); }
  }

  async function saveSummary() {
    setBusy(true);
    setSaveError(null);
    try {
      const papers = getContainer().papers;
      const body = await materializePaperBlobImages(draft, paper.id, (id, blob, ext) =>
        papers.uploadImage(id, blob, ext),
      );
      await papers.updatePaper.setSummary(paper.id, body);
      // Tags are derived solely from the note body's #hashtags.
      onReplace(await reconcileTagsFromBody(papers.manageTags, paper.id, body));
      setEditing(false);
    } catch (err) {
      setSaveError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onImagePick(file: File | null) {
    if (!file) return;
    try {
      const { blob, ext } = await compressImage(file);
      const path = await getContainer().papers.uploadImage(paper.id, blob, ext);
      setDraft((prev) => `${prev}\n${paperImageMarkdown(path, file.name)}\n`);
      setSaveError(null);
    } catch (err) {
      setSaveError(formatError(err));
    }
  }

  async function remove() {
    if (!confirm(`Remove "${paper.title}"? This also deletes its list memberships and graph edges.`)) return;
    setBusy(true);
    try {
      await getContainer().papers.deletePaper(paper);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function toggleCitationTracking() {
    if (!canTrackCitations || trackingCitations == null) return;
    setTrackingBusy(true);
    setSaveError(null);
    try {
      const updated = await getContainer().papers.setCitationTracking(
        paper.id,
        !trackingCitations,
      );
      setTrackingCitations(!trackingCitations);
      onReplace(updated);
    } catch (err) {
      setSaveError(formatError(err));
    } finally {
      setTrackingBusy(false);
    }
  }

  return (
    <div className="paper-note">
      <button type="button" className="btn-secondary paper-back" onClick={onBack}>← Papers</button>

      <div className="paper-note-head">
        {!readOnly && (
          <button
            type="button"
            className="entity-icon-btn danger"
            onClick={() => void remove()}
            disabled={busy}
            aria-label="Delete paper"
            title="Delete"
          >
            <DeleteIcon />
          </button>
        )}
        {readOnly ? (
          <PinnedPaperBadge ownerName={sharedByName} />
        ) : (
          <span className="paper-note-status">
            <Select
              className="status-select"
              value={paper.status}
              disabled={busy}
              onChange={(e) => void changeStatus(e.target.value as PaperStatus)}
              aria-label="Reading status"
            >
              {PAPER_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </Select>
          </span>
        )}
        <div className="card-foot-right">
          {readOnly ? (
            <CommentsToggle resourceType="paper" resourceId={paper.id} canComment={canComment} variant="detail" />
          ) : (
            <>
              <ShareButton resourceType="paper" resourceId={paper.id} title={`Share: ${paper.title}`} />
              <button
                type="button"
                className={`entity-icon-btn${trackingCitations ? " is-active" : ""}`}
                onClick={() => void toggleCitationTracking()}
                disabled={!canTrackCitations || trackingCitations == null || trackingBusy}
                aria-pressed={trackingCitations ?? false}
                aria-label={trackingCitations ? "Stop citation alerts" : "Track new citations"}
                title={
                  canTrackCitations
                    ? trackingCitations
                      ? "Citation alerts on"
                      : "Track new citations"
                    : "Add a DOI or arXiv ID to track citations"
                }
              >
                <BellIcon />
              </button>
              {!editing && (
                <button
                  type="button"
                  className="entity-icon-btn"
                  onClick={() => { setDraft(paper.summary ?? ""); setEditing(true); }}
                  aria-label={hasSummary ? "Edit note" : "Add note"}
                  title={hasSummary ? "Edit note" : "Add note"}
                >
                  <EditIcon />
                </button>
              )}
              {editing && (
                <button
                  type="button"
                  className="entity-icon-btn"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
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
              <CommentsToggle resourceType="paper" resourceId={paper.id} canComment variant="detail" />
            </>
          )}
        </div>
      </div>

      <h1 className="paper-article-title">{paper.title}</h1>
      <div className="paper-source-meta">
        {paper.authors.length > 0 && (
          <p className="muted paper-article-by">
            <strong>{paper.authors.slice(0, 6).join(", ")}{paper.authors.length > 6 ? " et al." : ""}</strong>
            {paper.year ? ` · ${paper.year}` : ""}
          </p>
        )}
        <ul className="paper-source-meta-list muted">
          {paper.venue && <li>Venue: {paper.venue}</li>}
          {paper.doi && <li>DOI: {paper.doi}</li>}
          {paper.arxivId && <li>arXiv: {paper.arxivId}</li>}
          {typeof paper.metadata?.["citeKey"] === "string" && paper.metadata["citeKey"] && (
            <li>Cite key: {String(paper.metadata["citeKey"])}</li>
          )}
        </ul>
        <PaperExternalLink paper={paper} />
      </div>

      <div className="paper-note-body">
        <details className="paper-source-section" open>
          <summary>Note</summary>
        {!editing ? (
          hasSummary
            ? <PaperMarkdown body={paper.summary!} className="summary" />
            : <p className="muted summary-empty">No note yet — use “Add note” to write one.</p>
        ) : (
          <div className="summary-editor">
            <MarkdownCodeEditor
              className="summary-input markdown-code-editor--notes"
              value={draft}
              placeholder="Write your note… Use #hashtags to link this paper in the graph. Math: $E = mc^2$ or $$\\frac{a}{b}$$."
              disabled={busy}
              onChange={setDraft}
              wikilinkTitles={wikilinkTitles}
              wikilinkCompletions={wikilinkCompletions}
            />
            <div className="summary-editor-foot">
              {saveError && <span className="error">{saveError}</span>}
              <button type="button" className="link-btn" onClick={() => setEditing(false)} disabled={busy}>cancel</button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void saveSummary()}
                disabled={busy || !dirty}
              >
                {busy ? "Saving…" : "Save note"}
              </button>
            </div>
          </div>
        )}
        {!editing && !readOnly && <TagEditor paper={paper} onReplace={onReplace} />}
        </details>

        {!editing && (
          <details className="paper-source-section" open>
            <summary>Fields</summary>
            <PaperFieldsStrip paperId={paper.id} readOnly={readOnly} />
          </details>
        )}
        {!editing && (
          <details className="paper-source-section" open>
            <summary>Annotations</summary>
            <PaperAnnotations paper={paper} readOnly={readOnly} />
          </details>
        )}
        {!editing && !readOnly && (
          <details className="paper-source-section">
            <summary>Related papers</summary>
            <RelatedPapersPanel paper={paper} onChanged={onChanged} />
          </details>
        )}
      </div>
    </div>
  );
}

/**
 * Project-scoped custom fields: inline values on the paper + a small manager
 * for define / rename / remove.
 */
function PaperFieldsStrip({ paperId, readOnly }: { paperId: string; readOnly: boolean }) {
  const [defs, setDefs] = useState<PaperFieldDef[]>([]);
  const [values, setValues] = useState<Map<string, PaperFieldValueData>>(new Map());
  const [projectValues, setProjectValues] = useState<PaperFieldValue[]>([]);
  const [library, setLibrary] = useState<Paper[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [managing, setManaging] = useState(false);

  const reload = useCallback(async () => {
    const papers = getContainer().papers;
    const [nextDefs, nextValues, allValues, screen] = await Promise.all([
      papers.listPaperFieldDefs(),
      papers.listPaperFieldValuesForPaper(paperId),
      papers.listPaperFieldValuesForProject(),
      papers.loadScreenData(),
    ]);
    setDefs(nextDefs);
    setValues(new Map(nextValues.map((v: PaperFieldValue) => [v.fieldId, v.value])));
    setProjectValues(allValues);
    setLibrary(screen.papers);
  }, [paperId]);

  useEffect(() => {
    let cancelled = false;
    void reload().catch((error) => {
      if (!cancelled) setMsg(formatError(error));
    });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  async function saveValue(fieldId: string, value: PaperFieldValueData | null) {
    setBusy(true);
    setMsg(null);
    try {
      await getContainer().papers.setPaperFieldValue(paperId, fieldId, value);
      await reload();
    } catch (error) {
      setMsg(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  if (defs.length === 0 && readOnly) return null;

  return (
    <div className="paper-fields">
      <div className="muted paper-fields-head">
        Custom fields
        {msg ? ` · ${msg}` : ""}
        {!readOnly && (
          <button
            type="button"
            className="link-btn"
            onClick={() => setManaging((open) => !open)}
          >
            {managing ? "Done" : "Manage"}
          </button>
        )}
      </div>

      {defs.length === 0 ? (
        <p className="muted paper-fields-empty">No fields yet — use Manage to add one.</p>
      ) : (
        <div className="paper-fields-grid">
          {defs.map((def) => {
            const rollupValue =
              def.kind === "rollup"
                ? computeRollup(paperId, def, defs, projectValues)
                : undefined;
            return (
              <PaperFieldEditor
                key={def.id}
                def={def}
                value={def.kind === "rollup" ? (rollupValue ?? undefined) : values.get(def.id)}
                papers={library.filter((p) => p.id !== paperId)}
                disabled={busy || readOnly || def.kind === "rollup"}
                onChange={(next) => void saveValue(def.id, next)}
              />
            );
          })}
        </div>
      )}

      {managing && !readOnly && (
        <PaperFieldsManager
          defs={defs}
          busy={busy}
          setBusy={setBusy}
          setMsg={setMsg}
          onChanged={reload}
        />
      )}
    </div>
  );
}

function PaperFieldEditor({
  def,
  value,
  papers = [],
  disabled,
  onChange,
}: {
  def: PaperFieldDef;
  value: PaperFieldValueData | undefined;
  papers?: Paper[];
  disabled: boolean;
  onChange: (next: PaperFieldValueData | null) => void;
}) {
  const textValue = typeof value === "string" ? value : "";
  const numberValue = typeof value === "number" ? String(value) : "";
  const multiValue = Array.isArray(value) ? value : [];
  const [draft, setDraft] = useState(
    def.kind === "number" ? numberValue : textValue,
  );

  useEffect(() => {
    setDraft(def.kind === "number" ? numberValue : textValue);
  }, [def.kind, numberValue, textValue]);

  function commitText() {
    const trimmed = draft.trim();
    const current = typeof value === "string" ? value : "";
    if (trimmed === current) return;
    onChange(trimmed || null);
  }

  function commitNumber() {
    const current = typeof value === "number" ? String(value) : "";
    if (draft.trim() === current) return;
    if (draft.trim() === "") {
      onChange(null);
      return;
    }
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(current);
      return;
    }
    onChange(n);
  }

  return (
    <label className="paper-field-row">
      <span className="paper-field-label">{def.name}</span>
      {def.kind === "text" && (
        <input
          type="text"
          className="paper-field-input"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitText}
        />
      )}
      {def.kind === "number" && (
        <input
          type="number"
          className="paper-field-input"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitNumber}
        />
      )}
      {def.kind === "select" && (
        <Select
          value={textValue}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
          aria-label={def.name}
        >
          <option value="">—</option>
          {def.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </Select>
      )}
      {(def.kind === "multi_select" || def.kind === "relation") && (
        <div className="paper-field-multi">
          {(def.kind === "relation" ? papers : def.options.map((opt) => ({ id: opt, title: opt }))).length === 0 ? (
            <span className="muted">No options</span>
          ) : def.kind === "relation" ? (
            papers.map((p) => {
              const checked = multiValue.includes(p.id);
              return (
                <label key={p.id} className="paper-field-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => {
                      const next = checked
                        ? multiValue.filter((x) => x !== p.id)
                        : [...multiValue, p.id];
                      onChange(next.length ? next : null);
                    }}
                  />
                  {p.title}
                </label>
              );
            })
          ) : (
            def.options.map((opt) => {
              const checked = multiValue.includes(opt);
              return (
                <label key={opt} className="paper-field-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => {
                      const next = checked
                        ? multiValue.filter((x) => x !== opt)
                        : [...multiValue, opt];
                      onChange(next.length ? next : null);
                    }}
                  />
                  {opt}
                </label>
              );
            })
          )}
        </div>
      )}
      {def.kind === "rollup" && (
        <span className="paper-field-rollup">
          {value == null ? "—" : Array.isArray(value) ? value.join(", ") : String(value)}
        </span>
      )}
    </label>
  );
}

function PaperFieldsManager({
  defs,
  busy,
  setBusy,
  setMsg,
  onChanged,
}: {
  defs: PaperFieldDef[];
  busy: boolean;
  setBusy: (v: boolean) => void;
  setMsg: (v: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PaperFieldKind>("text");
  const [optionsText, setOptionsText] = useState("");
  const [relationFieldId, setRelationFieldId] = useState("");
  const [rollupAgg, setRollupAgg] = useState<PaperFieldRollupAgg>("count");
  const [sourceFieldId, setSourceFieldId] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");

  const needsOptions = kind === "select" || kind === "multi_select";
  const relationDefs = defs.filter((d) => d.kind === "relation");
  const sourceDefs = defs.filter(
    (d) => d.kind !== "relation" && d.kind !== "rollup",
  );

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      await action();
      await onChanged();
    } catch (error) {
      setMsg(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="paper-fields-manager">
      <ul className="paper-fields-def-list">
        {defs.map((def) => (
          <li key={def.id} className="paper-fields-def-row">
            {renameId === def.id ? (
              <>
                <input
                  type="text"
                  className="paper-field-input"
                  value={renameName}
                  disabled={busy}
                  onChange={(e) => setRenameName(e.target.value)}
                  aria-label={`Rename ${def.name}`}
                />
                <button
                  type="button"
                  className="link-btn"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await getContainer().papers.renamePaperField(def.id, renameName);
                      setRenameId(null);
                    })
                  }
                >
                  Save
                </button>
                <button
                  type="button"
                  className="link-btn"
                  disabled={busy}
                  onClick={() => setRenameId(null)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span>
                  {def.name}{" "}
                  <span className="muted">({def.kind.replace("_", " ")})</span>
                </span>
                <button
                  type="button"
                  className="link-btn"
                  disabled={busy}
                  onClick={() => {
                    setRenameId(def.id);
                    setRenameName(def.name);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="link-btn"
                  disabled={busy}
                  onClick={() => {
                    if (!confirm(`Remove field "${def.name}"? Values on papers will be deleted.`)) {
                      return;
                    }
                    void run(() => getContainer().papers.removePaperField(def.id));
                  }}
                >
                  Remove
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      <div className="paper-fields-add">
        <input
          type="text"
          className="paper-field-input"
          placeholder="New field name"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <Select
          value={kind}
          disabled={busy}
          onChange={(e) => setKind(e.target.value as PaperFieldKind)}
          aria-label="Field kind"
        >
          {PAPER_FIELD_KINDS.map((k) => (
            <option key={k} value={k}>{k.replace("_", " ")}</option>
          ))}
        </Select>
        {needsOptions && (
          <input
            type="text"
            className="paper-field-input"
            placeholder="Options, comma-separated"
            value={optionsText}
            disabled={busy}
            onChange={(e) => setOptionsText(e.target.value)}
          />
        )}
        {kind === "rollup" && (
          <>
            <Select
              value={relationFieldId}
              disabled={busy || relationDefs.length === 0}
              onChange={(e) => setRelationFieldId(e.target.value)}
              aria-label="Rollup relation field"
            >
              <option value="">Relation field…</option>
              {relationDefs.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
            <Select
              value={rollupAgg}
              disabled={busy}
              onChange={(e) => setRollupAgg(e.target.value as PaperFieldRollupAgg)}
              aria-label="Rollup aggregation"
            >
              <option value="count">count</option>
              <option value="values">values</option>
              <option value="sum">sum</option>
              <option value="avg">avg</option>
            </Select>
            {rollupAgg !== "count" && (
              <Select
                value={sourceFieldId}
                disabled={busy || sourceDefs.length === 0}
                onChange={(e) => setSourceFieldId(e.target.value)}
                aria-label="Rollup source field"
              >
                <option value="">Source field…</option>
                {sourceDefs.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            )}
          </>
        )}
        <button
          type="button"
          className="btn-secondary"
          disabled={
            busy ||
            !name.trim() ||
            (kind === "rollup" &&
              (!relationFieldId || (rollupAgg !== "count" && !sourceFieldId)))
          }
          onClick={() =>
            void run(async () => {
              await getContainer().papers.definePaperField({
                name,
                kind,
                options: needsOptions
                  ? optionsText.split(",").map((s) => s.trim()).filter(Boolean)
                  : undefined,
                rollup:
                  kind === "rollup"
                    ? {
                        relationFieldId,
                        agg: rollupAgg,
                        sourceFieldId: rollupAgg === "count" ? undefined : sourceFieldId,
                      }
                    : undefined,
              });
              setName("");
              setOptionsText("");
              setRelationFieldId("");
              setSourceFieldId("");
              setRollupAgg("count");
              setKind("text");
            })
          }
        >
          Add field
        </button>
      </div>
    </div>
  );
}

/**
 * Tags for a paper. Tags are parsed from the note body's #hashtags — there is
 * no manual add here; deleting a chip removes that hashtag from the body.
 */
function TagEditor({ paper, onReplace }: { paper: Paper; onReplace: (p: Paper) => void }) {
  const [busy, setBusy] = useState(false);

  async function removeTag(tag: string) {
    setBusy(true);
    try {
      const papers = getContainer().papers;
      const body = removeHashtagFromBody(paper.summary ?? "", tag);
      await papers.updatePaper.setSummary(paper.id, body);
      onReplace(await reconcileTagsFromBody(papers.manageTags, paper.id, body));
    } finally {
      setBusy(false);
    }
  }

  if (paper.tags.length === 0) return null;
  return (
    <div className="tag-editor">
      <div className="tag-chips">
        {paper.tags.map((t) => (
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

interface StoredAnnotation {
  key?: string;
  kind?: "annotation" | "note";
  text?: string;
  comment?: string;
  color?: string;
  page?: string;
  tags?: string[];
}

/** Read-only list of Zotero PDF annotations cached on the paper (metadata.annotations). */
function PaperAnnotations({ paper, readOnly }: { paper: Paper; readOnly: boolean }) {
  const anns = (paper.metadata?.["annotations"] as StoredAnnotation[] | undefined) ?? [];
  const [msg, setMsg] = useState<string | null>(null);
  const [sections, setSections] = useState<{ id: string; title: string }[]>([]);
  const [pins, setPins] = useState<Map<string, string>>(new Map());
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const reloadPins = useCallback(async () => {
    const papers = getContainer().papers;
    const [availableSections, currentPins] = await Promise.all([
      papers.listReportSections(),
      papers.listAnnotationPinsForPaper(paper.id),
    ]);
    setSections(availableSections.map(({ id, title }) => ({ id, title })));
    setPins(new Map(currentPins.map((pin) => [pin.annotationKey, pin.reportSectionId])));
  }, [paper.id]);

  useEffect(() => {
    let cancelled = false;
    void reloadPins().catch((error) => {
      if (!cancelled) setMsg(formatError(error));
    });
    return () => {
      cancelled = true;
    };
  }, [reloadPins]);

  if (anns.length === 0) return null;

  async function copyCite(a: StoredAnnotation) {
    const quote = (a.text ?? a.comment ?? "").trim();
    if (!quote) return;
    try {
      await navigator.clipboard.writeText(formatQuoteCiteClipboard(quote, paper.title));
      setMsg("Copied quote + [[cite]]");
      window.setTimeout(() => setMsg(null), 1500);
    } catch {
      setMsg("Clipboard unavailable");
    }
  }

  async function setPin(annotationKey: string, sectionId: string | null) {
    setBusyKey(annotationKey);
    setMsg(null);
    try {
      await getContainer().papers.setAnnotationPin(paper.id, annotationKey, sectionId);
      await reloadPins();
    } catch (error) {
      setMsg(formatError(error));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="annotations">
      <div className="muted annotations-head">
        Zotero annotations & notes ({anns.length}) · read-only, synced from Zotero
        {msg ? ` · ${msg}` : ""}
      </div>
      <ul className="annotation-list">
        {anns.map((a, i) => (
          <li key={a.key ?? i} className="annotation">
            {a.color && <span className="annotation-swatch" style={{ background: a.color }} aria-hidden />}
            <div className="annotation-body">
              {a.kind === "note" && <span className="muted">Zotero note</span>}
              {a.text && <p className="annotation-text">{a.text}</p>}
              {a.comment && <p className="annotation-comment">{a.comment}</p>}
              {a.page && <p className="muted">p.{a.page}</p>}
              {a.tags && a.tags.length > 0 && (
                <div className="tag-chips">
                  {a.tags.map((t) => <span key={t} className="tag-chip">#{t}</span>)}
                </div>
              )}
              {(a.text || a.comment) && (
                <div className="annotation-actions">
                  <button type="button" className="link-btn" onClick={() => void copyCite(a)}>
                    Copy quote + cite
                  </button>
                  {a.key && !readOnly && (
                    <Select
                      className="annotation-pin-select"
                      aria-label="Pin annotation to report section"
                      value={pins.get(a.key) ?? ""}
                      disabled={busyKey === a.key}
                      onChange={(event) => void setPin(a.key!, event.target.value || null)}
                    >
                      <option value="">Unpinned</option>
                      {sections.map((section) => (
                        <option key={section.id} value={section.id}>{section.title}</option>
                      ))}
                    </Select>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

type RelatedHit = {
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  arxivId?: string;
  url?: string;
  abstract?: string;
  citationCount?: number;
};

function RelatedPapersPanel({ paper, onChanged }: { paper: Paper; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<RelatedHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function findRelated() {
    setBusy(true);
    setError(null);
    setMsg(null);
    setOpen(true);
    try {
      const { fetchRelatedPapers } = await import(
        "@/features/papers/application/fetch-related-papers"
      );
      const library = await getContainer().papers.loadScreenData();
      const next = await fetchRelatedPapers(paper, library.papers);
      setHits(next);
      if (next.length === 0) setMsg("No related papers found (needs DOI or arXiv id).");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function addHit(hit: RelatedHit) {
    setBusy(true);
    setError(null);
    try {
      await getContainer().papers.addPaper.addManual({
        title: hit.title,
        authors: hit.authors,
        year: hit.year,
        doi: hit.doi,
        arxivId: hit.arxivId,
        url: hit.url,
        summary: hit.abstract,
      });
      setMsg(`Added “${hit.title}”`);
      setHits((prev) => prev.filter((h) => h.title !== hit.title));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="related-papers">
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => void findRelated()}>
        {busy ? "Finding…" : "Find related papers"}
      </button>
      {open && (
        <div className="related-papers-panel">
          {error && <p className="error">{error}</p>}
          {msg && <p className="muted">{msg}</p>}
          <ul className="related-papers-list">
            {hits.map((h) => (
              <li key={`${h.doi ?? h.arxivId ?? h.title}`}>
                <strong className="related-paper-title">{h.title}</strong>
                <p className="muted related-paper-meta">
                  {h.authors.slice(0, 3).join(", ")}
                  {h.authors.length > 3 ? " et al." : ""}
                  {h.year ? ` · ${h.year}` : ""}
                  {typeof h.citationCount === "number"
                    ? ` · ${h.citationCount.toLocaleString()} citation${h.citationCount === 1 ? "" : "s"}`
                    : ""}
                </p>
                {h.url ? (
                  <a
                    className="related-paper-url"
                    href={h.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={h.url}
                  >
                    {h.url}
                  </a>
                ) : (
                  <p className="muted related-paper-url">No URL available</p>
                )}
                <div className="related-paper-actions">
                  {h.url && (
                    <a
                      className="link-btn"
                      href={h.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open paper
                    </a>
                  )}
                  <button type="button" className="link-btn" disabled={busy} onClick={() => void addHit(h)}>
                    Add to library
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
