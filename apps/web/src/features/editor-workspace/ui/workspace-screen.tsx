"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getContainer } from "@/bootstrap";
import { formatError } from "@/lib/format-error";
import { noteBodyText } from "@/lib/page-text";
import { commandForChord, isTypingTarget } from "../application/keybindings";
import { readLayout, writeLayout } from "../application/layout-storage";
import { bodyStats, formatCount, formatCursor } from "../application/document-stats";
import { breadcrumbs } from "../application/breadcrumbs";
import { outlineRows } from "../application/outline";
import {
  activateTab,
  activeTabRef,
  activeTabKey,
  closeTab,
  emptyLayout,
  focusPane,
  leaves,
  moveTab,
  openTab,
  pruneLayout,
  setRatio,
  setTabMode,
  splitPane,
  tabAt,
  tabKey,
  tabMode,
  toggleTabModeAt,
  type PaneLayout,
  type PaneSplit,
  type TabRef,
} from "../application/pane-tree";
import {
  buildListsTree,
  buildWorkspaceTree,
  flattenTree,
  listMembership,
  type ListItemEntry,
  type WorkspaceTreeNode,
} from "../application/workspace-tree";
import type { ExplorerSection } from "../application/explorer-state";
import { DocumentHost, type DocumentMetrics } from "./document-host";
import { ExplorerPanel } from "./explorer-panel";
import { PaneView, openTabs } from "./pane-view";
import { QuickOpenDialog } from "./quick-open-dialog";
import { StatusBar, saveState, type SegmentKey } from "./status-bar";
import { kindSuffix, segmentsFor } from "./kind";
import { FormError } from "@/components/form-error";
import type { WikilinkEntry } from "@/features/vault";

interface Document {
  kind: string;
  id: string;
  title: string;
  body: string;
  /** Where the document sits, for the breadcrumbs. */
  path: string;
}

function store(): Storage | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

/**
 * The desktop editor: the workspace as a stack of explorer sections and a set
 * of panes.
 *
 * Everything here is wiring. The trees come from `workspace-tree.ts`, the
 * layout rules from `pane-tree.ts`, the per-kind decisions from `ui/kind.ts`,
 * the renderer choice from `ui/document-host.tsx`, and the editors are the same
 * collaborative markdown stack the note, paper and report screens already use —
 * this screen only decides which of them a tab points at and how a save gets
 * home.
 */
export function WorkspaceScreen() {
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [tree, setTree] = useState<WorkspaceTreeNode[]>([]);
  const [listsTree, setListsTree] = useState<WorkspaceTreeNode[]>([]);
  const [membership, setMembership] = useState<ReadonlyMap<string, string[]>>(new Map());
  const [layout, setLayout] = useState<PaneLayout>(() => emptyLayout());
  const [error, setError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [metrics, setMetrics] = useState<Record<string, DocumentMetrics>>({});
  // Saves are debounced inside the editor, so a window closed a keystroke after
  // typing can have a write still in flight. Counted rather than a boolean:
  // several panes can be saving at once.
  const [pending, setPending] = useState(0);
  // A write that failed leaves the document dirty — "Saved" would be a lie.
  const [dirty, setDirty] = useState(false);
  const pendingRef = useRef(0);
  const reload = useCallback(async () => {
    const container = getContainer();
    const [vault, papers, report, lists] = await Promise.all([
      container.vault.loadScreenData(),
      container.papers.loadScreenData().catch(() => null),
      container.report.loadScreenData().catch(() => null),
      container.readingLists.loadScreenData().catch(() => null),
    ]);

    const paperRows = papers?.papers ?? [];
    const sectionRows = report?.flat ?? [];
    const listRows = lists?.lists ?? [];
    const loaded: Document[] = [
      ...vault.flat.map((page) => ({
        kind: "vault_page",
        id: page.id,
        title: page.title,
        // `vault.flat` holds summaries, which have no `body` — reading one off
        // them was always `undefined`, so every note in the workspace was
        // indexed with an empty body. `noteBodyText` prefers the full body when
        // the entry has been hydrated and falls back to the preview otherwise.
        body: noteBodyText(page),
        path: `notes/${page.title || "Untitled"}.note.md`,
      })),
      ...paperRows.map((paper) => ({
        kind: "paper",
        id: paper.id,
        title: paper.title,
        body: paper.summary ?? "",
        path: `papers/${paper.title || "Untitled"}.paper.md`,
      })),
      ...sectionRows.map((section) => ({
        kind: "report_section",
        id: section.id,
        title: section.title,
        body: section.notes ?? "",
        path: `report/${section.title || "Untitled"}.report.md`,
      })),
    ];

    setDocuments(loaded);
    setTree(
      buildWorkspaceTree({
        notes: vault.flat.map((page) => ({
          id: page.id,
          title: page.title,
          parentId: page.parentId ?? undefined,
        })),
        papers: paperRows.map((paper) => ({
          id: paper.id,
          title: paper.title,
          hasNote: Boolean(paper.summary?.trim()),
        })),
        reportSections: sectionRows.map((section) => ({
          id: section.id,
          title: section.title,
          parentId: section.parentId ?? undefined,
        })),
      }),
    );

    // Reading lists, as a view over the same documents rather than a second
    // copy of them. The membership rows are the many-to-many join in core.
    if (lists) {
      const titles = new Map<string, string>();
      for (const doc of loaded) titles.set(`${doc.kind}:${doc.id}`, doc.title);
      const listTitles = new Map(listRows.map((list) => [`reading_list:${list.id}`, list.name]));
      const items: ListItemEntry[] = [];
      if (listRows.length > 0) {
        const rows = await container.readingLists
          .listItemsForLists(listRows.map((list) => list.id))
          .catch(() => []);
        for (const row of rows) {
          if (row.paperId) {
            items.push({
              listId: row.listId,
              kind: "paper",
              id: row.paperId,
              inheritedFromListId: row.inheritedFromListId,
              duplicateOfItemId: row.duplicateOfItemId,
            });
          } else if (row.vaultPageId) {
            items.push({
              listId: row.listId,
              kind: "vault_page",
              id: row.vaultPageId,
              inheritedFromListId: row.inheritedFromListId,
              duplicateOfItemId: row.duplicateOfItemId,
            });
          }
        }
      }
      setListsTree(
        buildListsTree({
          lists: listRows.map((list) => ({
            id: list.id,
            title: list.name,
            parentId: list.parentId,
            description: list.description,
          })),
          items,
          titles,
        }),
      );
      setMembership(
        listMembership(
          items,
          new Map([...titles, ...listTitles]),
        ),
      );
    } else {
      setListsTree([]);
      setMembership(new Map());
    }

    return loaded;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await reload();
        if (cancelled) return;
        // Restore last session's panes, minus tabs whose entity is gone — a
        // layout outlives the documents in it.
        const open = new Set(loaded.map((doc) => tabKey(doc)));
        setLayout(pruneLayout(readLayout(store()), (tab) => open.has(tabKey(tab))));
      } catch (err) {
        if (!cancelled) setError(formatError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const apply = useCallback((next: PaneLayout) => {
    writeLayout(store(), next);
    setLayout(next);
    return next;
  }, []);

  const byKey = useMemo(
    () => new Map((documents ?? []).map((doc) => [tabKey(doc), doc])),
    [documents],
  );

  const labelFor = useCallback(
    (tab: TabRef) => byKey.get(tabKey(tab))?.title || "Untitled",
    [byKey],
  );

  const save = useCallback(
    async (tab: TabRef, body: string) => {
      const container = getContainer();
      pendingRef.current += 1;
      setPending(pendingRef.current);
      try {
        if (tab.kind === "vault_page") await container.vault.manageVaultPage.update(tab.id, { body });
        else if (tab.kind === "paper") await container.papers.updatePaper.setSummary(tab.id, body);
        else if (tab.kind === "report_section")
          await container.report.manageReportSection.setNotes(tab.id, body);
        setDirty(false);
        setDocuments((current) =>
          (current ?? []).map((doc) =>
            doc.kind === tab.kind && doc.id === tab.id ? { ...doc, body } : doc,
          ),
        );
      } catch (err) {
        setDirty(true);
        setError(formatError(err));
      } finally {
        pendingRef.current -= 1;
        setPending(pendingRef.current);
      }
    },
    [],
  );

  // The browser only honours the guard if the handler is registered before the
  // close is attempted, so it lives here rather than being added when a save
  // starts.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (pendingRef.current <= 0) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const active = activeTabRef(layout);
  const activeKeyOf = active ? tabKey(active) : undefined;

  // Where Read mode's wikilinks can go. The same lists `/notes` hands
  // `VaultMarkdown`, built from the documents this screen already loaded.
  const links = useMemo(() => {
    const rows = documents ?? [];
    return {
      notes: rows.filter((doc) => doc.kind === "vault_page").map((doc) => ({ id: doc.id, title: doc.title })),
      papers: rows.filter((doc) => doc.kind === "paper").map((doc) => ({ id: doc.id, title: doc.title })),
      sections: rows
        .filter((doc) => doc.kind === "report_section")
        .map((doc) => ({ id: doc.id, title: doc.title })),
    };
  }, [documents]);

  const openLink = useCallback(
    (entry: WikilinkEntry) => {
      if (!entry.id) return;
      // A wikilink in Read mode opens the target's tab. There is no
      // click-to-edit at the caret: source and rendered positions do not map,
      // and pretending they do is where live-preview editors go wrong.
      apply(openTab(layout, { kind: "vault_page", id: entry.id }));
    },
    [apply, layout],
  );

  const renderDocument = useCallback(
    (tab: TabRef) => {
      const key = tabKey(tab);
      const doc = byKey.get(key);
      if (!doc) return <p className="muted">This document is no longer in the workspace.</p>;
      return (
        <DocumentHost
          tab={tab}
          mode={tabMode(tab)}
          body={doc.body}
          links={links}
          onSave={(body: string) => save(tab, body)}
          onMetrics={(next) => setMetrics((current) => ({ ...current, [key]: next }))}
          onOpenLink={openLink}
        />
      );
    },
    [byKey, links, openLink, save],
  );

  // One mount per open document, not per visible tab, so the same note in two
  // panes is the same editor twice rather than two documents.
  const documentNodes = useMemo(() => flattenTree(tree), [tree]);

  // The Outline section: the headings of the document on screen, read from the
  // same parse Read mode renders. Collapsed by default, and empty for a
  // document with no headings. Tabs, not a second document: a heading row
  // scrolls the pane rather than opening anything.
  const outline = useMemo(() => {
    const body = activeKeyOf ? metrics[activeKeyOf]?.text ?? byKey.get(activeKeyOf)?.body ?? "" : "";
    return outlineRows(body).map<WorkspaceTreeNode>((heading, index) => ({
      key: `outline:${index}:${heading.slug}`,
      kind: "folder",
      label: heading.text,
      // The slug is the id the Read view writes, so a click finds the heading
      // it names with no second parse and no offset table to keep in step.
      path: heading.slug,
      children: [],
      headingLevel: heading.level,
    }));
  }, [activeKeyOf, byKey, metrics]);

  /** A heading row scrolls the pane it belongs to; nothing opens. */
  const jumpToHeading = useCallback((node: WorkspaceTreeNode) => {
    if (!node.path) return;
    document.getElementById(node.path)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  // The explorer's sections. Files is the mirror folder; Reading lists is a
  // view over the same documents; Outline is a view over the one on screen.
  const sections: ExplorerSection[] = useMemo(
    () => [
      { id: "files", title: "Files", tree },
      { id: "lists", title: "Reading lists", tree: listsTree },
      { id: "outline", title: "Outline", tree: outline, collapsedByDefault: true },
    ],
    [tree, listsTree, outline],
  );

  // Breadcrumbs and the minimap are per pane, because a split shows two
  // documents and each one has its own path and its own shape.
  const crumbsFor = useCallback(
    (tab: TabRef) => breadcrumbs({ kind: tab.kind, id: tab.id }, tree, listsTree),
    [tree, listsTree],
  );

  const metricsFor = useCallback((tab: TabRef) => metrics[tabKey(tab)], [metrics]);
  const bodyFor = useCallback(
    (tab: TabRef) => metrics[tabKey(tab)]?.text ?? byKey.get(tabKey(tab))?.body ?? "",
    [byKey, metrics],
  );

  const openNode = useCallback(
    (node: WorkspaceTreeNode, options: { split: boolean }) => {
      if (!node.id || node.kind === "folder") return;
      const tab = { kind: node.kind, id: node.id };
      apply(openTab(options.split ? splitPane(layout, layout.focusedPaneId, "row") : layout, tab));
      setPaletteOpen(false);
    },
    [apply, layout],
  );

  // Bound on the window rather than on the shell so a shortcut still works
  // while focus is inside a CodeMirror instance, which stops propagation of
  // plenty of keys on its way to handling them.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = commandForChord(event);
      if (!command) return;
      if (isTypingTarget(event.target as HTMLElement | null)) return;
      event.preventDefault();

      if (command === "quick-open") return setPaletteOpen(true);

      setLayout((current) => {
        const pane = current.focusedPaneId;
        if (command === "split-right") return apply(splitPane(current, pane, "row"));
        const leaf = leaves(current.root).find((candidate) => candidate.id === pane);
        if (!leaf || leaf.tabs.length === 0) return current;
        if (command === "close-tab") return apply(closeTab(current, pane, leaf.activeIndex));
        // `⌘E` flips the document on screen between the source editor and the
        // rendered read view (§3.9). It is a property of the document, so it
        // survives a tab switch, a split and a reload of the layout.
        if (command === "toggle-mode") return apply(toggleTabModeAt(current, pane, leaf.activeIndex));
        const step = command === "next-tab" ? 1 : -1;
        // Cycling wraps: Ctrl-Tab on the last tab lands on the first, which is
        // what makes it a cycle rather than a walk that stops at the end.
        const next = (leaf.activeIndex + step + leaf.tabs.length) % leaf.tabs.length;
        return apply(activateTab(current, pane, next));
      });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [apply]);

  if (error && !documents) return <FormError>{error}</FormError>;
  if (!documents) return <p className="muted">Loading workspace…</p>;

  const activeDoc = activeKeyOf ? byKey.get(activeKeyOf) : undefined;
  const activeMetrics = activeKeyOf ? metrics[activeKeyOf] : undefined;
  const activeBody = activeMetrics?.text ?? activeDoc?.body ?? "";
  const stats = bodyStats(activeBody);
  const peers = 0;

  const values: Partial<Record<SegmentKey, string>> = activeDoc
    ? {
        words: `${formatCount(stats.words)} words`,
        chars: `${formatCount(stats.chars)} chars`,
        cursor: activeMetrics?.cursor ? formatCursor(activeMetrics.cursor) : undefined,
        encoding: "UTF-8",
        language: "Markdown",
        peers: peers > 0 ? `${peers + 1} editing` : undefined,
        branch: undefined,
      }
    : {};

  return (
    <div className="workspace-shell">
      <ExplorerPanel
        sections={sections}
        activeKey={activeKeyOf}
        listNames={membership}
        onOpen={(selection) =>
          apply(openTab(layout, { kind: selection.kind, id: selection.id }))
        }
        onStartNote={(paperId) => {
          // The paper document exists for every paper (it is the summary), so
          // "start note" is simply opening that tab — the same call the row's
          // own click makes. No new data path, and the button finally renders.
          apply(openTab(layout, { kind: "paper", id: paperId }));
        }}
        onRelease={jumpToHeading}
      />
      <PaneView
        layout={layout}
        labelFor={labelFor}
        renderDocument={renderDocument}
        crumbsFor={crumbsFor}
        metricsFor={metricsFor}
        bodyFor={bodyFor}
        onOpenCrumb={(crumb) => {
          if (!crumb.key) return;
          const [kind, ...rest] = crumb.key.split(":");
          const id = rest.join(":");
          if (kind && id) apply(openTab(layout, { kind, id }));
        }}
        onActivate={(paneId, index) => apply(activateTab(layout, paneId, index))}
        onClose={(paneId, index) => apply(closeTab(layout, paneId, index))}
        onFocus={(paneId) => apply(focusPane(layout, paneId))}
        onSplit={(paneId, direction) => apply(splitPane(layout, paneId, direction))}
        onDropTab={(from, toPaneId) => apply(moveTab(layout, from, toPaneId))}
        onRatio={(split: PaneSplit, ratio) => apply(setRatio(layout, split, ratio))}
        onToggleMode={(paneId, index) => apply(toggleTabModeAt(layout, paneId, index))}
        onSetMode={(paneId, index, mode) => {
          const tab = tabAt(layout, paneId, index);
          if (tab) apply(setTabMode(layout, tab, mode));
        }}
      />
      <StatusBar
        save={saveState({ pending, dirty })}
        segments={activeDoc ? segmentsFor(activeDoc.kind) : []}
        values={values}
      />
      {error ? <p className="error workspace-error">{error}</p> : null}
      {paletteOpen ? (
        <QuickOpenDialog
          documents={documentNodes}
          onPick={openNode}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}
    </div>
  );
}
