"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { usePinnedOwnerNames } from "@/features/sharing";
import { AddListForm } from "./add-list-form";
import { EmptyState } from "@/components/empty-state";
import { NavIcon } from "@/app/nav-icon";
import { collectListIds } from "./list-ui";
import { ListNode, type ListTreeContext } from "./list-node";
import { runListAction } from "./run-list-action";
import { ListsRail, findListNode } from "./lists-rail";
import { useProject } from "@/features/projects";
import { projectScopedKey, usePersistedState } from "@/lib/hooks/use-persisted-state";
import { useScreenData } from "@/lib/hooks/use-screen-data";
import { emptyArray, emptyMap } from "@/lib/empty";
import { usePinnedSharing } from "@/lib/hooks/use-pinned-sharing";
import type { ReadingListsScreenData } from "@/features/reading-lists/application/load-reading-lists-screen.use-case";
import { ScreenHead } from "@/components/screen-head";
import { useScreenSearch } from "@/lib/hooks/use-screen-search";
import { FormError } from "@/components/form-error";
import { loadSubtreeItems } from "@/features/reading-lists/application/subtree-items";

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
    () => new Set(collectListIds(tree)),
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
      // A shared list is not in the owned data: fetch it, unless the link
      // changed meanwhile. A failed fetch is shown, so the link never just
      // silently fails to focus.
      let cancelled = false;
      void runListAction(async () => {
        const l = await getContainer().readingLists.getList(focusFromUrl);
        if (cancelled || !l) return;
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
      }, (message) => {
        if (message && !cancelled) setError(message);
      });
      return () => {
        cancelled = true;
      };
    }
  }, [focusFromUrl, flat, isSharedView, pinnedSharedBy, setData]);

  const { isReadOnly: isReadOnlyList, sharedOwnerName, isPinned: isPinnedList } = usePinnedSharing({ isSharedView, pinnedSharedBy, ownerNames });

  // Two panes: the rail picks one list, the right pane shows it and its sublists.
  // A list id belongs to one project: each project remembers its own pick.
  const projectId = useProject().current?.id;
  const [storedSelected, setSelected] = usePersistedState<string>(projectScopedKey("thesis.lists.selected", projectId), "");
  const [search, setSearch] = useState("");
  const match = useScreenSearch(search, "list");
  const railTree = useMemo(() => {
    if (!search.trim()) return tree;
    const hits = new Set(match(flat, (l) => l.id, (l) => l.name).map((l) => l.id));
    return matchTree(tree, hits);
  }, [tree, flat, search, match]);
  const railPinned = useMemo(() => match(pinnedLists, (l) => l.id, (l) => l.name), [pinnedLists, match]);
  useEffect(() => {
    if (focusFromUrl) setSelected(focusFromUrl);
  }, [focusFromUrl, setSelected]);
  const selectedNode = useMemo((): ReadingListTreeNode | null => {
    const pick = (id: string): ReadingListTreeNode | null => {
      if (!id) return null;
      const inTree = findListNode(tree, id);
      if (inTree) return inTree;
      const pinned = pinnedLists.find((l) => l.id === id) ?? (id === focusFromUrl ? flat.find((l) => l.id === id) : undefined);
      return pinned ? { list: pinned, children: [] } : null;
    };
    return (
      pick(storedSelected) ??
      tree[0] ??
      (pinnedLists[0] ? { list: pinnedLists[0], children: [] } : null)
    );
  }, [storedSelected, tree, pinnedLists, flat, focusFromUrl]);


  // One fetch for the shown subtree's items, not one per list node (36-08).
  const [itemsByList, setItemsByList] = useState<ReadonlyMap<string, ReadingListItem[]>>(() => new Map());
  useEffect(() => {
    if (!selectedNode) return;
    let active = true;
    const readingLists = getContainer().readingLists;
    loadSubtreeItems(selectedNode, (ids) => readingLists.listItemsForLists(ids))
      .then((byList) => {
        if (active) setItemsByList(byList);
      })
      .catch((err: unknown) => {
        if (active) setError(formatError(err));
      });
    return () => {
      active = false;
    };
  }, [selectedNode, refresh]);

  const bump = useCallback(() => setRefresh((n) => n + 1), []);
  const paperTitles = useMemo(() => new Map(papers.map((p) => [p.id, p.title])), [papers]);
  const noteTitles = useMemo(() => new Map(notes.map((n) => [n.id, n.title])), [notes]);
  const listNames = useMemo(() => new Map(flat.map((l) => [l.id, l.name])), [flat]);

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
    itemsByList,
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
      <ScreenHead
        eyebrow={listsEyebrow(flat)}
        search={flat.length > 0 ? { value: search, onChange: setSearch, label: "Search lists" } : undefined}
      >
        <button className="btn-primary" onClick={() => setAddOpen(true)}>New list</button>
      </ScreenHead>

      {addOpen && (
        <Modal title="New reading list" onClose={() => setAddOpen(false)}>
          <AddListForm parents={flat} onAdded={() => { setAddOpen(false); void load(); }} />
        </Modal>
      )}

      {error && <FormError>{error}</FormError>}
      {!error && tree.length === 0 && pinnedLists.length === 0 && (
        <EmptyState
          variant="first-run"
          icon={<NavIcon name="list" />}
          title="No reading lists yet"
          body="A reading list is how a pile of papers becomes an argument: group them by theme, nest the groups, and keep the reason each one is there. It is a view over your papers, not a second copy of them."
          action={
            <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>
              New list
            </button>
          }
        />
      )}

      {!error && selectedNode && (
        <div className="lists-two-pane">
          <ListsRail
            tree={railTree}
            pinned={railPinned}
            selectedId={selectedNode.list.id}
            onSelect={setSelected}
          />
          <div className="card list-tree-panel">
            {selectedNode.children.length > 0 && (
              <div className="list-tree-toolbar">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setCollapsed(new Set(collectListIds(selectedNode.children)))}
                >
                  Collapse all
                </button>
                <button type="button" className="link-btn" onClick={() => setCollapsed(new Set())}>
                  Expand all
                </button>
              </div>
            )}
            <ul className="list-tree-root">
              <ListNode
                {...treeContext}
                key={selectedNode.list.id}
                node={selectedNode}
                depth={0}
                isCollapsed={false}
                readOnly={isReadOnlyList(selectedNode.list.id) || !ownedIds.has(selectedNode.list.id)}
                isPinned={isPinnedList(selectedNode.list.id)}
                sharedByName={sharedOwnerName(selectedNode.list.id)}
                canComment={listCanComment.get(selectedNode.list.id) ?? false}
              />
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

/** Lists the search found, with their whole subtree, plus the parents leading to them. */
function matchTree(nodes: readonly ReadingListTreeNode[], hits: ReadonlySet<string>): ReadingListTreeNode[] {
  return nodes.flatMap((n) => {
    if (hits.has(n.list.id)) return [n];
    const children = matchTree(n.children, hits);
    return children.length ? [{ ...n, children }] : [];
  });
}

/** "2 lists · 1 sublist": the count the brutal themes set over the title. */
function listsEyebrow(lists: ReadingList[]): string | undefined {
  if (lists.length === 0) return undefined;
  const sub = lists.filter((l) => l.parentId).length;
  const top = lists.length - sub;
  const parts = [`${top} ${top === 1 ? "list" : "lists"}`];
  if (sub > 0) parts.push(`${sub} ${sub === 1 ? "sublist" : "sublists"}`);
  return parts.join(" · ");
}
