"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { getContainer } from "@/bootstrap";
import { CollabBodyHost } from "@/features/collab";
import { formatError } from "@/lib/format-error";
import { readLayout, writeLayout } from "../application/layout-storage";
import {
  activateTab,
  closeTab,
  emptyLayout,
  focusPane,
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
import { buildWorkspaceTree, type WorkspaceTreeNode } from "../application/workspace-tree";
import { ExplorerPanel } from "./explorer-panel";
import { PaneView, openTabs } from "./pane-view";

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
    }
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
    </div>
  );
}
