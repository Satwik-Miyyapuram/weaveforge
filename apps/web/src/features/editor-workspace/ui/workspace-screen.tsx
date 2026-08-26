"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getContainer } from "@/bootstrap";
import { CollabBodyHost } from "@/features/collab";
import { formatError } from "@/lib/format-error";
import { commandForChord, isTypingTarget } from "../application/keybindings";
import { readLayout, writeLayout } from "../application/layout-storage";
import {
  activateTab,
  closeTab,
  emptyLayout,
  focusPane,
  leaves,
  moveTab,
  openTab,
  pruneLayout,
  setRatio,
  splitPane,
  tabKey,
  type PaneLayout,
  type PaneSplit,
  type TabRef,
} from "../application/pane-tree";
import {
  buildWorkspaceTree,
  flattenTree,
  type WorkspaceTreeNode,
} from "../application/workspace-tree";
import { ExplorerPanel } from "./explorer-panel";
import { PaneView, openTabs } from "./pane-view";
import { QuickOpenDialog } from "./quick-open-dialog";

interface Document {
  kind: string;
  id: string;
  title: string;
  body: string;
}

function store(): Storage | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

/**
 * The desktop editor: the workspace as an explorer and a set of panes.
 *
 * Everything here is wiring. The tree comes from `workspace-tree.ts`, the
 * layout rules from `pane-tree.ts`, and the editors are the same collaborative
 * markdown stack the note, paper and report screens already use — this screen
 * only decides which of them a tab points at and how a save gets home.
 */
export function WorkspaceScreen() {
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [tree, setTree] = useState<WorkspaceTreeNode[]>([]);
  const [layout, setLayout] = useState<PaneLayout>(() => emptyLayout());
  const [error, setError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Saves are debounced inside the editor, so a window closed a keystroke after
  // typing can have a write still in flight. Counted rather than a boolean:
  // several panes can be saving at once.
  const pending = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const container = getContainer();
        const [vault, papers, report] = await Promise.all([
          container.vault.loadScreenData(),
          container.papers.loadScreenData().catch(() => null),
          container.report.loadScreenData().catch(() => null),
        ]);
        if (cancelled) return;

        const paperRows = papers?.papers ?? [];
        const sectionRows = report?.flat ?? [];
        const loaded: Document[] = [
          ...vault.flat.map((page) => ({
            kind: "vault_page",
            id: page.id,
            title: page.title,
            body: page.body ?? "",
          })),
          ...paperRows.map((paper) => ({
            kind: "paper",
            id: paper.id,
            title: paper.title,
            body: paper.summary ?? "",
          })),
          ...sectionRows.map((section) => ({
            kind: "report_section",
            id: section.id,
            title: section.title,
            body: section.notes ?? "",
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
  }, []);

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

  const save = useCallback(async (tab: TabRef, body: string) => {
    const container = getContainer();
    pending.current += 1;
    try {
      if (tab.kind === "vault_page") await container.vault.manageVaultPage.update(tab.id, { body });
      else if (tab.kind === "paper") await container.papers.updatePaper.setSummary(tab.id, body);
      else if (tab.kind === "report_section")
        await container.report.manageReportSection.setNotes(tab.id, body);
      setDocuments((current) =>
        (current ?? []).map((doc) =>
          doc.kind === tab.kind && doc.id === tab.id ? { ...doc, body } : doc,
        ),
      );
    } catch (err) {
      setError(formatError(err));
    } finally {
      pending.current -= 1;
    }
  }, []);

  // The browser only honours the guard if the handler is registered before the
  // close is attempted, so it lives here rather than being added when a save
  // starts.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (pending.current <= 0) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const renderDocument = useCallback(
    (tab: TabRef) => {
      const doc = byKey.get(tabKey(tab));
      if (!doc) return <p className="muted">This document is no longer in the workspace.</p>;
      return (
        <CollabBodyHost
          resourceType={tab.kind}
          resourceId={tab.id}
          initialBody={doc.body}
          onSave={(body: string) => save(tab, body)}
          markdownEditing={{ placeholder: "Write…" }}
          editorClassName="workspace-editor"
        />
      );
    },
    [byKey, save],
  );

  // One mount per open document, not per visible tab, so the same note in two
  // panes is the same editor twice rather than two documents.
  const mounted = useMemo(() => openTabs(layout), [layout]);
  const documentNodes = useMemo(() => flattenTree(tree), [tree]);

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

  if (error && !documents) return <p className="error">{error}</p>;
  if (!documents) return <p className="muted">Loading workspace…</p>;

  return (
    <div className="workspace-shell">
      <ExplorerPanel
        tree={tree}
        activeKey={mounted.length > 0 ? tabKey(mounted[0]!) : undefined}
        onOpen={(selection) =>
          apply(openTab(layout, { kind: selection.kind, id: selection.id }))
        }
      />
      <PaneView
        layout={layout}
        labelFor={labelFor}
        renderDocument={renderDocument}
        onActivate={(paneId, index) => apply(activateTab(layout, paneId, index))}
        onClose={(paneId, index) => apply(closeTab(layout, paneId, index))}
        onFocus={(paneId) => apply(focusPane(layout, paneId))}
        onSplit={(paneId, direction) => apply(splitPane(layout, paneId, direction))}
        onDropTab={(from, toPaneId) => apply(moveTab(layout, from, toPaneId))}
        onRatio={(split: PaneSplit, ratio) => apply(setRatio(layout, split, ratio))}
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
