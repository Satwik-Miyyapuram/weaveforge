"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import type {
  Paper,
  ReadingList,
  ReadingListItem,
  ReadingListTreeNode,
  VaultPage,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { formatError } from "@/lib/format-error";
import { Modal } from "@/components/modal";
import { ScreenLoading } from "@/components/screen-loading";
import { ShareButton, CommentsToggle, PinnedPaperBadge, usePinnedOwnerNames } from "@/features/sharing";
import { AddListForm } from "./add-list-form";
import { Select } from "@/components/select";
import { ChevronIcon } from "@/components/chevron-icon";
import { DeleteIcon, UnlinkIcon } from "@/components/view-icons";
import { collectListIds, listDisplayColor } from "./list-ui";
import { ExtractionTable } from "./extraction-table";
import { usePersistedState } from "@/lib/hooks/use-persisted-state";
import { useScreenData } from "@/lib/hooks/use-screen-data";
import { emptyArray, emptyMap } from "@/lib/empty";
import { usePinnedSharing } from "@/lib/hooks/use-pinned-sharing";
import type { ReadingListsScreenData } from "@/features/reading-lists/application/load-reading-lists-screen.use-case";

type ListsViewData = ReadingListsScreenData & { ownerNames: Map<string, string> };

/**
 * Reading-lists screen. Renders the nested list hierarchy; each list shows its
 * member papers with an inline picker to add more. Presentation + view-state
 * only — all data access goes through the container.
 */
export function ListsScreen() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const isSharedView = searchParams.get("shared") === "1";
  const focusFromUrl = searchParams.get("list");
  const appliedFocus = useRef<string | null>(null);

  const loadScreen = useCallback(async (): Promise<ListsViewData> => {
    const data = await getContainer().readingLists.loadScreenData();
    // Owner labels arrive separately — see usePinnedOwnerNames. Awaiting the
    // lab directory here delayed the whole screen by ~1.8s.
    return { ...data, ownerNames: emptyMap<string, string>() };
  }, []);

  const { data, loading, error: loadError, reload, setData } = useScreenData("lists", loadScreen);

  usePinnedOwnerNames(data, setData);

  useEffect(() => {
    setError(loadError);
  }, [loadError]);

  const tree = data?.tree ?? emptyArray<ReadingListTreeNode>();
  const flat = data?.lists ?? emptyArray<ReadingList>();
  const papers = data?.papers ?? emptyArray<Paper>();
  const notes = data?.notes ?? emptyArray<VaultPage>();
  const pinnedSharedBy = data?.pinnedSharedBy ?? emptyMap<string, string>();
  const listCanComment = data?.listCanComment ?? emptyMap<string, boolean>();
  const ownerNames = data?.ownerNames ?? emptyMap<string, string>();

  const ownedIds = useMemo(
    () => new Set(tree.flatMap((n) => collectListIdsFromNode(n))),
    [tree],
  );

  const pinnedLists = useMemo(
    () => flat.filter((l) => pinnedSharedBy.has(l.id) && !ownedIds.has(l.id)),
    [flat, pinnedSharedBy, ownedIds],
  );

  const load = useCallback(async () => {
    await reload();
    setRefresh((n) => n + 1);
  }, [reload]);

  useEffect(() => {
    if (!focusFromUrl) {
      appliedFocus.current = null;
      return;
    }
    if (appliedFocus.current === focusFromUrl) return;
    if (flat.some((l) => l.id === focusFromUrl)) {
      appliedFocus.current = focusFromUrl;
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(focusFromUrl);
        return next;
      });
      requestAnimationFrame(() => {
        document.getElementById(`list-${focusFromUrl}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    if (isSharedView || pinnedSharedBy.has(focusFromUrl)) {
      void getContainer()
        .readingLists.getList(focusFromUrl)
        .then((l) => {
          if (!l) return;
          appliedFocus.current = focusFromUrl;
          setData((prev) =>
            prev && !prev.lists.some((x) => x.id === l.id)
              ? { ...prev, lists: [...prev.lists, l] }
              : prev,
          );
          setCollapsed((prev) => {
            const next = new Set(prev);
            next.delete(focusFromUrl);
            return next;
          });
          requestAnimationFrame(() => {
            document.getElementById(`list-${focusFromUrl}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
          });
        });
    }
  }, [focusFromUrl, flat, isSharedView, pinnedSharedBy, setData]);

  const { isReadOnly: isReadOnlyList, sharedOwnerName } = usePinnedSharing({ isSharedView, pinnedSharedBy, ownerNames });


  const bump = useCallback(() => setRefresh((n) => n + 1), []);
  const paperTitles = useMemo(() => new Map(papers.map((p) => [p.id, p.title])), [papers]);
  const noteTitles = useMemo(() => new Map(notes.map((n) => [n.id, n.title])), [notes]);
  const listNames = useMemo(() => new Map(flat.map((l) => [l.id, l.name])), [flat]);
  const allListIds = useMemo(() => collectListIds(tree), [tree]);

  const toggleCollapsed = useCallback((listId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(listId)) next.delete(listId);
      else next.add(listId);
      return next;
    });
  }, []);

  const treeContext: ListTreeContext = {
    papers,
    notes,
    paperTitles,
    noteTitles,
    listNames,
    refresh,
    collapsedSet: collapsed,
    onToggleCollapse: toggleCollapsed,
    onChanged: bump,
    onReload: load,
  };

  if (loading) {
    return <ScreenLoading status="Loading reading lists…" />;
  }

  return (
    <section className="screen lists-screen">
      <header className="screen-head">
        <div className="head-row">
          <div className="screen-actions">
            <button className="btn-primary" onClick={() => setAddOpen(true)}>+ List</button>
          </div>
        </div>
      </header>

      {addOpen && (
        <Modal title="New reading list" onClose={() => setAddOpen(false)}>
          <AddListForm parents={flat} onAdded={() => { setAddOpen(false); void load(); }} />
        </Modal>
      )}

      {error && <p className="error">{error}</p>}
      {!error && tree.length === 0 && pinnedLists.length === 0 && (
        <div className="empty">
          <p>No lists yet. Use “+ List” to create your first grouping.</p>
        </div>
      )}

      {!error && (tree.length > 0 || pinnedLists.length > 0) && (
        <div className="card list-tree-panel">
          {tree.length > 0 && (
            <>
          <div className="list-tree-toolbar">
            <button
              type="button"
              className="link-btn"
              onClick={() => setCollapsed(new Set(allListIds))}
            >
              Collapse all
            </button>
            <button type="button" className="link-btn" onClick={() => setCollapsed(new Set())}>
              Expand all
            </button>
          </div>
          <ul className="list-tree-root">
            {tree.map((node) => (
              <ListNode
                {...treeContext}
                key={node.list.id}
                node={node}
                depth={0}
                isCollapsed={collapsed.has(node.list.id)}
                readOnly={isReadOnlyList(node.list.id)}
                sharedByName={sharedOwnerName(node.list.id)}
                canComment={listCanComment.get(node.list.id) ?? false}
              />
            ))}
          </ul>
            </>
          )}
          {pinnedLists.length > 0 && (
            <>
              <h4 className="settings-group vault-pinned-label">Shared with you</h4>
              <ul className="list-tree-root">
                {pinnedLists.map((list) => (
                  <ListNode
                    {...treeContext}
                    key={list.id}
                    node={{ list, children: [] }}
                    depth={0}
                    isCollapsed={collapsed.has(list.id)}
                    readOnly
                    sharedByName={sharedOwnerName(list.id)}
                    canComment={listCanComment.get(list.id) ?? false}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function collectListIdsFromNode(node: ReadingListTreeNode): string[] {
  return [node.list.id, ...node.children.flatMap(collectListIdsFromNode)];
}

function parseListPicker(value: string): { kind: "paper" | "note"; id: string } | null {
  if (value.startsWith("paper:")) return { kind: "paper", id: value.slice(6) };
  if (value.startsWith("note:")) return { kind: "note", id: value.slice(5) };
  return null;
}

function listItemTitle(
  item: ReadingListItem,
  paperTitles: Map<string, string>,
  noteTitles: Map<string, string>,
): string {
  if (item.paperId) return paperTitles.get(item.paperId) ?? item.paperId;
  if (item.vaultPageId) return noteTitles.get(item.vaultPageId) ?? item.vaultPageId;
  return "Unknown";
}

function listCountLabel(items: ReadingListItem[]): string {
  const papers = items.filter((i) => i.paperId).length;
  const notes = items.filter((i) => i.vaultPageId).length;
  const parts: string[] = [];
  if (papers > 0) parts.push(`${papers} paper${papers === 1 ? "" : "s"}`);
  if (notes > 0) parts.push(`${notes} note${notes === 1 ? "" : "s"}`);
  return parts.join(", ") || "0 items";
}

/**
 * Everything a node needs that is the same for every node in one tree.
 *
 * Named and passed as a unit because it was spelled out at three call sites —
 * the root tree, the shared-with-you list and the recursive child — and adding
 * a prop meant remembering all three.
 */
interface ListTreeContext {
  papers: Paper[];
  notes: VaultPage[];
  paperTitles: Map<string, string>;
  noteTitles: Map<string, string>;
  listNames: Map<string, string>;
  refresh: number;
  collapsedSet: Set<string>;
  onToggleCollapse: (listId: string) => void;
  onChanged: () => void;
  onReload: () => void;
}

interface ListNodeProps extends ListTreeContext {
  node: ReadingListTreeNode;
  depth: number;
  isCollapsed: boolean;
  readOnly?: boolean;
  sharedByName?: string;
  canComment?: boolean;
}

function ListNode(props: ListNodeProps) {
  const {
    node,
    depth,
    papers,
    notes,
    paperTitles,
    noteTitles,
    listNames,
    refresh,
    collapsedSet,
    isCollapsed,
    onToggleCollapse,
    onChanged,
    onReload,
    readOnly = false,
    sharedByName,
    canComment = false,
  } = props;
  const list = node.list;
  const [items, setItems] = useState<ReadingListItem[]>([]);
  const [picker, setPicker] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [dropItemId, setDropItemId] = useState<string | null>(null);
  const [view, setView] = usePersistedState<"tree" | "table">(
    `thesis.lists.view.${list.id}`,
    "tree",
  );
  const hasChildren = node.children.length > 0;
  const dotColor = listDisplayColor(list);

  const loadItems = useCallback(async () => {
    setItems(await getContainer().readingLists.listItems(list.id));
  }, [list.id]);

  useEffect(() => {
    void loadItems();
  }, [loadItems, refresh]);

  async function addItem() {
    const ref = parseListPicker(picker);
    if (!ref || addBusy) return;
    setAddError(null);
    setAddBusy(true);
    try {
      const manage = getContainer().readingLists.manageReadingList;
      if (ref.kind === "paper") {
        await manage.addPaperToList(list.id, ref.id);
      } else {
        await manage.addNoteToList(list.id, ref.id);
      }
      setPicker("");
      setShowAdd(false);
      onChanged();
    } catch (err) {
      setAddError(formatError(err));
    } finally {
      setAddBusy(false);
      await loadItems();
    }
  }

  async function removeItem(item: ReadingListItem) {
    const manage = getContainer().readingLists.manageReadingList;
    if (item.paperId) {
      await manage.removePaperFromList(list.id, item.paperId);
    } else if (item.vaultPageId) {
      await manage.removeNoteFromList(list.id, item.vaultPageId);
    }
    await loadItems();
    onChanged();
  }

  async function deleteList() {
    const childCount = node.children.length;
    const msg =
      childCount > 0
        ? `Delete "${list.name}" and its ${childCount} sublist(s)?`
        : `Delete "${list.name}"?`;
    if (!confirm(msg)) return;
    setDeleteBusy(true);
    try {
      await getContainer().readingLists.manageReadingList.removeList(list.id);
      onReload();
    } finally {
      setDeleteBusy(false);
    }
  }

  async function reorderItems(dragId: string, targetId: string) {
    if (dragId === targetId) return;
    const ids = items.map((i) => i.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    const byId = new Map(items.map((i) => [i.id, i]));
    const prev = items;
    setReorderError(null);
    setItems(next.map((id, sortOrder) => ({ ...byId.get(id)!, sortOrder })));
    try {
      await getContainer().readingLists.manageReadingList.reorderItems(list.id, next);
      onChanged();
    } catch (err) {
      setItems(prev);
      setReorderError(formatError(err));
    }
  }

  const memberPaperIds = new Set(items.flatMap((i) => (i.paperId ? [i.paperId] : [])));
  const memberNoteIds = new Set(items.flatMap((i) => (i.vaultPageId ? [i.vaultPageId] : [])));
  const availablePapers = papers.filter((p) => !memberPaperIds.has(p.id));
  const availableNotes = notes.filter((n) => !memberNoteIds.has(n.id));
  const canAdd = availablePapers.length > 0 || availableNotes.length > 0;
  const countLabel = listCountLabel(items);

  return (
    <li id={`list-${list.id}`} className="list-node" style={{ "--depth": depth } as CSSProperties}>
      <div className="list-row">
        <button
          type="button"
          className="list-toggle"
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? "Expand list" : "Collapse list"}
          onClick={() => onToggleCollapse(list.id)}
        >
          <ChevronIcon open={!isCollapsed} variant="expand" size={14} />
        </button>
        <span className="list-color-dot" style={{ background: dotColor }} aria-hidden />
        <h3 className="list-row-title">{list.name}</h3>
        <span className="list-count">{countLabel}</span>
        <div className="list-view-toggle" role="group" aria-label="List view">
          <button
            type="button"
            className={`link-btn${view === "tree" ? " is-active" : ""}`}
            aria-pressed={view === "tree"}
            onClick={() => setView("tree")}
          >
            Tree
          </button>
          <button
            type="button"
            className={`link-btn${view === "table" ? " is-active" : ""}`}
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
          >
            Table
          </button>
        </div>
        {readOnly ? (
          <PinnedPaperBadge ownerName={sharedByName} />
        ) : (
          <>
            <button
              type="button"
              className="entity-icon-btn danger list-del"
              onClick={() => void deleteList()}
              disabled={deleteBusy}
              aria-label={`Delete list ${list.name}`}
              title="Delete"
            >
              <DeleteIcon />
            </button>
            <ShareButton resourceType="reading_list" resourceId={list.id} title={`Share: ${list.name}`} />
          </>
        )}
        <CommentsToggle
          resourceType="reading_list"
          resourceId={list.id}
          canComment={readOnly ? canComment : true}
        />
      </div>

      {!isCollapsed && (
        <div className="list-body">
          {view === "table" ? (
            <ExtractionTable node={node} papers={papers} readOnly={readOnly} />
          ) : (
            <>
          {items.length > 0 && (
            <ul className="list-papers">
              {items.map((i) => (
                <li
                  key={i.id}
                  className={`list-paper-row${dropItemId === i.id ? " drag-over" : ""}`}
                  draggable={!readOnly}
                  onDragStart={() => setDragItemId(i.id)}
                  onDragEnd={() => { setDragItemId(null); setDropItemId(null); }}
                  onDragOver={(e) => { e.preventDefault(); setDropItemId(i.id); }}
                  onDragLeave={() => setDropItemId((id) => (id === i.id ? null : id))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragItemId) void reorderItems(dragItemId, i.id);
                    setDragItemId(null);
                    setDropItemId(null);
                  }}
                >
                  <span className="list-drag-handle" aria-hidden title="Drag to reorder">⋮⋮</span>
                  <span className={`list-item-kind${i.vaultPageId ? " list-item-kind--note" : ""}`}>
                    {i.vaultPageId ? "note" : "paper"}
                  </span>
                  <span className="list-paper-title">{listItemTitle(i, paperTitles, noteTitles)}</span>
                  {i.inheritedFromListId && (
                    <span className="list-via-badge">
                      via {listNames.get(i.inheritedFromListId) ?? "sublist"}
                    </span>
                  )}
                  {!readOnly && (
                  <button
                    className="list-item-remove entity-icon-btn"
                    onClick={() => void removeItem(i)}
                    aria-label="Remove from list"
                    title="Remove from list"
                  >
                    <UnlinkIcon />
                  </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {items.length === 0 && !showAdd && (
            <p className="muted list-empty">No papers or notes in this list yet.</p>
          )}

          {showAdd && canAdd && !readOnly ? (
            <div className="list-add">
              <Select
                searchable
                searchPlaceholder="Search papers and notes…"
                value={picker}
                onChange={(e) => { setPicker(e.target.value); setAddError(null); }}
              >
                <option value="">Choose a paper or note…</option>
                {availablePapers.length > 0 && (
                  <optgroup label="Papers">
                    {availablePapers.map((p) => (
                      <option key={p.id} value={`paper:${p.id}`}>
                        {p.title}
                      </option>
                    ))}
                  </optgroup>
                )}
                {availableNotes.length > 0 && (
                  <optgroup label="Notes">
                    {availableNotes.map((n) => (
                      <option key={n.id} value={`note:${n.id}`}>
                        {n.title}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Select>
              <button
                type="button"
                className="btn-primary"
                disabled={!picker || addBusy}
                onClick={() => void addItem()}
              >
                {addBusy ? "Adding…" : "Add"}
              </button>
              <button
                type="button"
                className="link-btn"
                onClick={() => { setShowAdd(false); setPicker(""); setAddError(null); }}
              >
                cancel
              </button>
              {addError && <p className="error list-add-error">{addError}</p>}
              {reorderError && <p className="error list-add-error">{reorderError}</p>}
            </div>
          ) : canAdd && !readOnly ? (
            <button type="button" className="link-btn list-add-trigger" onClick={() => setShowAdd(true)}>
              + add paper or note
            </button>
          ) : null}
            </>
          )}

          {hasChildren && (
            <ul className="list-children">
              {node.children.map((child) => (
                <ListNode
                  {...props}
                  key={child.list.id}
                  node={child}
                  depth={depth + 1}
                  isCollapsed={collapsedSet.has(child.list.id)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
