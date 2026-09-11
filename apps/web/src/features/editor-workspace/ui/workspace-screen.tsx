"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { extractHashtags, normalizeTitleKey } from "@weaveforge/core";

import { getContainer } from "@/bootstrap";
import { AttachImageButton } from "@/components/attach-image-button";
import type { EditorHandleRef } from "@/components/editor-handle";
import { formatError } from "@/lib/format-error";
import { paperCiteLabel, type CiteCompletion } from "@/lib/hooks/use-cite-links";
import { noteBodyText } from "@/lib/page-text";
import { useWikilinkCreateMode } from "@/lib/wikilink-create-preference";
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
import { NewDocumentDialog, type FolderOption } from "./new-document-dialog";
import { PaneView, openTabs } from "./pane-view";
import { QuickOpenDialog } from "./quick-open-dialog";
import { StatusBar, saveState, type SegmentKey } from "./status-bar";
import { isCreatableKind, isDocumentKind, kindSuffix, linkGroupOf, memberRank, segmentsFor } from "./kind";
import { FormError } from "@/components/form-error";

interface Document {
  kind: string;
  id: string;
  title: string;
  body: string;
  /** Where the document sits, for the breadcrumbs. */
  path: string;
  /** A note's folder; the tree nests notes by parent. */
  parentId?: string;
  /** A paper's keyword tags, for `#tag` completion. Notes carry theirs inline. */
  tags?: readonly string[];
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
  const [completions, setCompletions] = useState<CiteCompletion[]>([]);
  const [tree, setTree] = useState<WorkspaceTreeNode[]>([]);
  const [listsTree, setListsTree] = useState<WorkspaceTreeNode[]>([]);
  const [membership, setMembership] = useState<ReadonlyMap<string, string[]>>(new Map());
  const [layout, setLayout] = useState<PaneLayout>(() => emptyLayout());
  const [error, setError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [creating, setCreating] = useState<"note" | "folder" | null>(null);
  const createMode = useWikilinkCreateMode();
  // One handle per open document, so the pane's image button reaches the
  // editor in the tab it sits over. The boxes outlive their editors: a handle
  // is null until the lazily-loaded editor mounts and null again once it is
  // gone, which is exactly what `AttachImageButton` expects.
  const handles = useRef(new Map<string, EditorHandleRef>());
  const handleFor = useCallback((tab: TabRef): EditorHandleRef => {
    const key = tabKey(tab);
    let handle = handles.current.get(key);
    if (!handle) {
      handle = { current: null };
      handles.current.set(key, handle);
    }
    return handle;
  }, []);
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
        parentId: page.parentId ?? undefined,
      })),
      ...paperRows.map((paper) => ({
        kind: "paper",
        id: paper.id,
        title: paper.title,
        body: paper.summary ?? "",
        path: `papers/${paper.title || "Untitled"}.paper.md`,
        tags: paper.tags,
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
    // The `@` and `[[` rows, in the shape `/notes` builds them: a paper's row
    // carries its authors and year so a cite can be formatted, a note's and a
    // section's just their title. Duplicate titles collapse to one row.
    const seen = new Set<string>();
    const rows: CiteCompletion[] = [];
    for (const paper of paperRows) {
      const key = normalizeTitleKey(paper.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(paperCiteLabel(paper));
    }
    const titled = [
      ...vault.flat.map((page) => ({ title: page.title, detail: "note" })),
      ...sectionRows.map((section) => ({ title: section.title, detail: "section" })),
    ];
    for (const row of titled) {
      const key = normalizeTitleKey(row.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push({ title: row.title, label: row.title, detail: row.detail });
    }
    setCompletions(rows);
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
          // Papers before notes, from `kind.ts`'s own ordering column, so the
          // rule is not a comparison against `"paper"` in two places.
          memberRank,
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
        // Which use case writes a body, as a lookup rather than an
        // `if (kind === …)` chain. It cannot live in `ui/kind.ts` — the values
        // are container calls, and that table is pure data — but it is the same
        // kind of per-kind column, and it is the one an ink note adds a row to.
        const writers: Record<string, (id: string, next: string) => Promise<unknown>> = {
          vault_page: (id, next) => container.vault.manageVaultPage.update(id, { body: next }),
          paper: (id, next) => container.papers.updatePaper.setSummary(id, next),
          report_section: (id, next) => container.report.manageReportSection.setNotes(id, next),
        };
        await writers[tab.kind]?.(tab.id, body);
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

  // Where Read mode's wikilinks can go. The same three lists `/notes` hands
  // `VaultMarkdown`, built from the documents this screen already loaded. Which
  // kind resolves against which list is `kind.ts`'s `linkGroup`, so a kind that
  // cannot be linked to is left out rather than filtered by name here.
  const links = useMemo(() => {
    const rows = documents ?? [];
    const inGroup = (group: "notes" | "papers" | "sections") =>
      rows
        .filter((doc) => linkGroupOf(doc.kind) === group)
        .map((doc) => ({ id: doc.id, title: doc.title }));
    return {
      notes: inGroup("notes"),
      papers: inGroup("papers"),
      sections: inGroup("sections"),
    };
  }, [documents]);

  // Every `#tag` the project uses, for completion: the ones written inline in
  // any document plus the ones a paper carries as a field. Sorted so the list
  // is stable between keystrokes.
  const tags = useMemo(() => {
    const all = new Set<string>();
    for (const doc of documents ?? []) {
      for (const tag of extractHashtags(doc.body)) all.add(tag);
      for (const tag of doc.tags ?? []) all.add(tag);
    }
    return [...all].sort();
  }, [documents]);

  const openLink = useCallback(
    (tab: TabRef) => {
      // A wikilink in Read mode opens the target's tab. There is no
      // click-to-edit at the caret: source and rendered positions do not map,
      // and pretending they do is where live-preview editors go wrong.
      apply(openTab(layout, tab));
    },
    [apply, layout],
  );

  // A new note, from the explorer's button, the new-note chord, a "Create
  // note" completion row or a click on an unresolved link. Made through the
  // same use case `/notes` uses, reloaded so the tree and the link lists see
  // it, then opened as a tab. Titles are unique, so a title that exists
  // already opens rather than fails.
  const createNote = useCallback(
    async (input: { title: string; parentId?: string }, opts: { open?: boolean } = {}) => {
      const wanted = normalizeTitleKey(input.title);
      const existing = (documents ?? []).find(
        (doc) => isCreatableKind(doc.kind) && normalizeTitleKey(doc.title) === wanted,
      );
      const id = existing
        ? existing.id
        : (await getContainer().vault.manageVaultPage.add({ title: input.title, parentId: input.parentId })).id;
      if (!existing) await reload();
      if (opts.open !== false) apply(openTab(layout, { kind: "vault_page", id }));
    },
    [apply, documents, layout, reload],
  );

  const createFromLink = useCallback(
    (title: string, opts?: { open?: boolean }) => {
      void createNote({ title }, opts).catch((err) => setError(formatError(err)));
    },
    [createNote],
  );

  // The notes that can hold a new one — every note can — in tree order with
  // their depth, for the dialog's parent list.
  const folders = useMemo<FolderOption[]>(() => {
    const notes = (documents ?? []).filter((doc) => isCreatableKind(doc.kind));
    const byParent = new Map<string | undefined, Document[]>();
    for (const note of notes) {
      const list = byParent.get(note.parentId) ?? [];
      list.push(note);
      byParent.set(note.parentId, list);
    }
    const out: FolderOption[] = [];
    const walk = (parentId: string | undefined, depth: number) => {
      for (const note of byParent.get(parentId) ?? []) {
        out.push({ id: note.id, title: note.title, depth });
        walk(note.id, depth + 1);
      }
    };
    walk(undefined, 0);
    return out;
  }, [documents]);

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
          completions={completions}
          tags={tags}
          onSave={(body: string) => save(tab, body)}
          onMetrics={(next) => setMetrics((current) => ({ ...current, [key]: next }))}
          onOpenLink={openLink}
          onCreateNote={createMode === "create" ? createFromLink : undefined}
          handleRef={handleFor(tab)}
          onError={setError}
        />
      );
    },
    [byKey, links, completions, tags, openLink, save, createMode, createFromLink, handleFor],
  );

  // The pane's toolbar, for a tab in Edit mode: the same image button the
  // note, paper and report screens show, inserting at the caret of the editor
  // under it. Drag and paste already work inside the editor; this is the third
  // way in, for a picture on disk.
  const renderTools = useCallback(
    (tab: TabRef) => <AttachImageButton editor={handleFor(tab)} onError={setError} />,
    [handleFor],
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

  // Breadcrumbs are per pane, because a split shows two documents and each
  // one has its own path.
  const crumbsFor = useCallback(
    (tab: TabRef) => breadcrumbs({ kind: tab.kind, id: tab.id }, tree, listsTree),
    [tree, listsTree],
  );


  const openNode = useCallback(
    (node: WorkspaceTreeNode, options: { split: boolean }) => {
      if (!node.id || !isDocumentKind(node.kind)) return;
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
      if (command === "new-note") return setCreating("note");

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
        onNewNote={() => setCreating("note")}
        onNewFolder={() => setCreating("folder")}
      />
      <PaneView
        layout={layout}
        labelFor={labelFor}
        renderDocument={renderDocument}
        renderTools={renderTools}
        crumbsFor={crumbsFor}
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
      {creating ? (
        <NewDocumentDialog
          kind={creating}
          folders={folders}
          initialParentId={activeDoc && isCreatableKind(activeDoc.kind) ? activeDoc.parentId : undefined}
          onCreate={createNote}
          onClose={() => setCreating(null)}
        />
      ) : null}
    </div>
  );
}
