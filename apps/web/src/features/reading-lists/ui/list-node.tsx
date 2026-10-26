"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { Paper, ReadingListItem, ReadingListTreeNode, VaultPage } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { formatError } from "@/lib/format-error";
import { CommentsToggle, PinnedPaperBadge } from "@/features/sharing";
import { Select } from "@/components/select";
import { ChevronIcon } from "@/components/chevron-icon";
import { CompareViewIcon, FilterIcon, TreeViewIcon, UnlinkIcon } from "@/components/view-icons";
import { EntityCardMenu } from "@/components/entity-card-menu";
import { SegmentedControl } from "@/components/segmented-control";
import { usePersistedState } from "@/lib/hooks/use-persisted-state";
import { listDisplayColor, movedIds, reorderedIds } from "./list-ui";
import { ExtractionTable } from "./extraction-table";
import { ScreeningPanel } from "./screening-panel";
import { runListAction } from "./run-list-action";
import { Button } from "@/components/button";
import { deferDelete, deletedMessage, useHiddenKeys } from "@/lib/toast";

/** The key a list hides under while its Undo toast shows (D-07). */
export const listKey = (id: string) => `list:${id}`;

/** A list's three views, as icon buttons named by their tooltip. */
const LIST_VIEWS = [
  { id: "tree", label: "Tree view", Icon: TreeViewIcon },
  { id: "table", label: "Table view", Icon: CompareViewIcon },
  { id: "screen", label: "Screening view", Icon: FilterIcon },
] as const;

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
  // "Empty" rather than "0 items": the filled lists beside it count papers and
  // notes, and a third noun for the same count read as a different measure.
  return parts.join(", ") || "Empty";
}

/**
 * Everything a node needs that is the same for every node in one tree.
 *
 * Named and passed as a unit because it was spelled out at three call sites —
 * the root tree, the shared-with-you list and the recursive child — and adding
 * a prop meant remembering all three.
 */
export interface ListTreeContext {
  papers: Paper[];
  notes: VaultPage[];
  paperTitles: Map<string, string>;
  noteTitles: Map<string, string>;
  listNames: Map<string, string>;
  /** Items of every list in the shown subtree, fetched once by the screen. */
  itemsByList: ReadonlyMap<string, ReadingListItem[]>;
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
  isPinned?: boolean;
  sharedByName?: string;
  canComment?: boolean;
}

/**
 * One reading list in the tree: its header, its items in the chosen view, and
 * its sublists, each rendered by this same component.
 */
export function ListNode(props: ListNodeProps) {
  const {
    node,
    depth,
    papers,
    notes,
    paperTitles,
    noteTitles,
    listNames,
    itemsByList,
    collapsedSet,
    isCollapsed,
    onToggleCollapse,
    onChanged,
    onReload,
    readOnly = false,
    isPinned = false,
    sharedByName,
    canComment = false,
  } = props;
  const list = node.list;
  const loaded = itemsByList.get(list.id);
  // Local copy so a drag reorder can show at once and roll back on failure.
  const [items, setItems] = useState<ReadingListItem[]>(loaded ?? []);
  useEffect(() => {
    setItems(loaded ?? []);
  }, [loaded]);
  const [picker, setPicker] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Remove, reorder, delete and unpin failures, shown under the items.
  const [actionError, setActionError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const hiddenKeys = useHiddenKeys();
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [dropItemId, setDropItemId] = useState<string | null>(null);
  const [view, setView] = usePersistedState<"tree" | "table" | "screen">(
    `thesis.lists.view.${list.id}`,
    "tree",
  );
  const hasChildren = node.children.length > 0;
  const dotColor = listDisplayColor(list);

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
    } catch (err) {
      setAddError(formatError(err));
    } finally {
      setAddBusy(false);
      onChanged();
    }
  }

  async function removeItem(item: ReadingListItem) {
    await runListAction(async () => {
      const manage = getContainer().readingLists.manageReadingList;
      if (item.paperId) {
        await manage.removePaperFromList(list.id, item.paperId);
      } else if (item.vaultPageId) {
        await manage.removeNoteFromList(list.id, item.vaultPageId);
      }
      onChanged();
    }, setActionError);
  }

  // Delete hides the list (and its sublists) at once; the delete runs when
  // the Undo toast closes (D-07). A failure shows on the toast.
  function deleteList() {
    const childCount = node.children.length;
    deferDelete({
      keys: [listKey(list.id)],
      message: childCount > 0 ? `${deletedMessage(list.name)} with ${childCount} sublist(s)` : deletedMessage(list.name),
      commit: async () => {
        await getContainer().readingLists.manageReadingList.removeList(list.id);
        onReload();
      },
    });
  }

  // Unpinning a shared list removes only your copy; the owner keeps theirs.
  function unpinList() {
    deferDelete({
      keys: [listKey(list.id)],
      message: `"${list.name}" removed from your lists`,
      commit: async () => {
        await getContainer().sharing.unpinShared("reading_list", list.id);
        onReload();
      },
    });
  }

  /** Show the new order at once; roll it back if saving it fails. */
  async function applyOrder(next: string[] | null) {
    if (!next) return;
    const byId = new Map(items.map((i) => [i.id, i]));
    const prev = items;
    setItems(next.map((id, sortOrder) => ({ ...byId.get(id)!, sortOrder })));
    const saved = await runListAction(async () => {
      await getContainer().readingLists.manageReadingList.reorderItems(list.id, next);
      onChanged();
    }, setActionError);
    if (!saved) setItems(prev);
  }

  const itemIds = items.map((i) => i.id);
  const reorderItems = (dragId: string, targetId: string) => applyOrder(reorderedIds(itemIds, dragId, targetId));
  const moveItem = (id: string, step: -1 | 1) => applyOrder(movedIds(itemIds, id, step));

  const memberPaperIds = new Set(items.flatMap((i) => (i.paperId ? [i.paperId] : [])));
  const memberNoteIds = new Set(items.flatMap((i) => (i.vaultPageId ? [i.vaultPageId] : [])));
  const availablePapers = papers.filter((p) => !memberPaperIds.has(p.id));
  const availableNotes = notes.filter((n) => !memberNoteIds.has(n.id));
  const canAdd = availablePapers.length > 0 || availableNotes.length > 0;
  const countLabel = listCountLabel(items);

  if (hiddenKeys.has(listKey(list.id))) return null;

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
        <SegmentedControl
          label="List view"
          className="list-view-toggle"
          value={view}
          onChange={setView}
          options={LIST_VIEWS.map(({ id, label, Icon }) => ({ value: id, label: <Icon />, ariaLabel: label, title: label }))}
        />
        {readOnly && <PinnedPaperBadge ownerName={sharedByName} />}
        {(!readOnly || isPinned) && (
          // Share and Delete sit behind one ⋯, as on every entity card: deleting
          // a list is rare, and a red icon on every row was the loudest thing
          // on the screen. Delete can be undone from its toast.
          <EntityCardMenu
            resourceType="reading_list"
            resourceId={list.id}
            title={`Share: ${list.name}`}
            name={list.name}
            onDelete={isPinned ? unpinList : deleteList}
            deleteLabel={isPinned ? "Remove from lists" : "Delete list"}
          />
        )}
        <CommentsToggle
          resourceType="reading_list"
          resourceId={list.id}
          canComment={readOnly ? canComment : true}
          isOwner={!readOnly}
        />
      </div>

      {!isCollapsed && (
        <div className="list-body">
          {view === "table" ? (
            <ExtractionTable node={node} papers={papers} readOnly={readOnly} />
          ) : view === "screen" ? (
            <ScreeningPanel node={node} papers={papers} readOnly={readOnly} />
          ) : (
            <>
          {items.length > 0 && (
            <ul className="list-papers">
              {items.map((i, index) => (
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
                    <ListItemActions
                      isFirst={index === 0}
                      isLast={index === items.length - 1}
                      onMove={(step) => void moveItem(i.id, step)}
                      onRemove={() => void removeItem(i)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}

          {actionError && <p className="error list-add-error">{actionError}</p>}

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
              <Button
                variant="primary"
                disabled={!picker || addBusy}
                onClick={() => void addItem()}
              >
                {addBusy ? "Adding…" : "Add"}
              </Button>
              <button
                type="button"
                className="btn-ghost btn-cancel"
                onClick={() => { setShowAdd(false); setPicker(""); setAddError(null); }}
              >
                Cancel
              </button>
              {addError && <p className="error list-add-error">{addError}</p>}
            </div>
          ) : canAdd && !readOnly ? (
            <button type="button" className="link-btn list-add-trigger" onClick={() => setShowAdd(true)}>
              + Add a paper or note
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

/**
 * An item's buttons: move up and down, the keyboard way to reorder (dragging
 * needs a pointer), and remove.
 */
export function ListItemActions({
  isFirst,
  isLast,
  onMove,
  onRemove,
}: {
  isFirst: boolean;
  isLast: boolean;
  onMove: (step: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <span className="list-item-actions">
      <button
        type="button"
        className="list-item-move entity-icon-btn"
        onClick={() => onMove(-1)}
        disabled={isFirst}
        aria-label="Move up"
        title="Move up"
      >
        <span aria-hidden>↑</span>
      </button>
      <button
        type="button"
        className="list-item-move entity-icon-btn"
        onClick={() => onMove(1)}
        disabled={isLast}
        aria-label="Move down"
        title="Move down"
      >
        <span aria-hidden>↓</span>
      </button>
      <button
        type="button"
        className="list-item-remove entity-icon-btn"
        onClick={onRemove}
        aria-label="Remove from list"
        title="Remove from list"
      >
        <UnlinkIcon />
      </button>
    </span>
  );
}
