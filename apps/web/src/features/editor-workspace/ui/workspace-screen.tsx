"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { extractHashtags, normalizeTitleKey } from "@weaveforge/core";

import { getContainer } from "@/bootstrap";
import { AttachImageButton } from "@/components/attach-image-button";
import type { EditorHandleRef } from "@/components/editor-handle";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { formatError } from "@/lib/format-error";
import type { CiteCompletion } from "@/lib/hooks/use-cite-links";
import { defaultInkNoteMeta, writeInkNoteBody } from "@weaveforge/core";

import { useWikilinkCreateMode } from "@/lib/wikilink-create-preference";
import { commandForChord, isTypingTarget } from "../application/keybindings";
import { readLayout, writeLayout } from "../application/layout-storage";
import { loadWorkspace, noteKind, type Document } from "../application/workspace-load";
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
import { flattenTree, type WorkspaceTreeNode } from "../application/workspace-tree";
import type { ExplorerSection } from "../application/explorer-state";
import { DocumentHost, type DocumentMetrics } from "./document-host";
import { ExplorerPanel } from "./explorer-panel";
import { creationKindFor, creationTarget, draftMakes, type Draft } from "../application/explorer-edit";
import { readHidden, writeHidden } from "../application/explorer-state";
import { FocusGlyph, PaneView, openTabs } from "./pane-view";
import { QuickOpenDialog } from "./quick-open-dialog";
import { StatusBar, saveState, type SegmentKey } from "./status-bar";
import { hasInkView, hasLazyBody, isCreatableKind, isDocumentKind, kindOwner, kindSuffix, linkGroupOf, memberRank, segmentsFor } from "./kind";
import { FormError } from "@/components/form-error";

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
  // The explorer's draft row: what it will make and where. Owned here so the
  // `⌘N` chord and the panel's own buttons start the same thing.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [explorerHidden, setExplorerHidden] = useState(false);
  // Focus: the document and nothing else. Per session, not per device — a
  // window that reopens with every control hidden looks broken, not focused.
  const [focus, setFocus] = useState(false);
  const toggleFocus = useCallback(() => setFocus((current) => !current), []);
  // The primary nav rail lives outside this screen (app-shell), so the flag is
  // also put on the root element for nav.css to read.
  useEffect(() => {
    const root = document.documentElement;
    if (focus) root.dataset.workspaceFocus = "";
    else delete root.dataset.workspaceFocus;
    // The desktop shell's own chrome — menu bar, title bar — goes with it.
    desktop()?.setWindowFocus?.(focus);
    return () => {
      delete root.dataset.workspaceFocus;
      desktop()?.setWindowFocus?.(false);
    };
  }, [focus]);
  // The chord handler is bound once; it reads the document on screen through
  // a ref rather than closing over a stale one.
  const activeDocRef = useRef<Document | undefined>(undefined);
  useEffect(() => setExplorerHidden(readHidden(store())), []);
  const toggleExplorer = useCallback(() => {
    setExplorerHidden((current) => {
      writeHidden(store(), !current);
      return !current;
    });
  }, []);
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
  // Full note bodies fetched so far, by id, so a reload does not throw them
  // away; and the fetches in flight, so a tab rendered twice asks once.
  const hydratedRef = useRef(new Map<string, string>());
  const hydratingRef = useRef(new Set<string>());
  const reload = useCallback(async () => {
    const data = await loadWorkspace(hydratedRef.current);
    setDocuments(data.documents);
    setCompletions(data.completions);
    setTree(data.tree);
    setListsTree(data.listsTree);
    setMembership(data.membership);
    return data.documents;
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

  const documentsRef = useRef(documents);
  documentsRef.current = documents;

  const save = useCallback(
    async (tab: TabRef, body: string) => {
      // A body may only go back to the store once the full one has come in.
      // The editor is not mounted before that, but an editor that saved the
      // 320-character preview would overwrite the note with it — a loss the
      // store cannot undo — so the door is barred here as well.
      const doc = documentsRef.current?.find((d) => d.kind === tab.kind && d.id === tab.id);
      if (hasLazyBody(tab.kind) && doc && !doc.hydrated) {
        setError("This note is still loading; the edit was not saved.");
        return;
      }
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
          // An ink note is a vault page whose body starts with the ink header (§4.1).
          ink_page: (id, next) => container.vault.manageVaultPage.update(id, { body: next }),
          paper: (id, next) => container.papers.updatePaper.setSummary(id, next),
          report_section: (id, next) => container.report.manageReportSection.setNotes(id, next),
        };
        await writers[tab.kind]?.(tab.id, body);
        setDirty(false);
        if (hasLazyBody(tab.kind)) hydratedRef.current.set(tab.id, body);
        setDocuments((current) =>
          (current ?? []).map((doc) =>
            doc.kind === tab.kind && doc.id === tab.id ? { ...doc, body, hydrated: true } : doc,
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
    async (input: { title: string; parentId?: string; ink?: boolean }, opts: { open?: boolean } = {}) => {
      const wanted = normalizeTitleKey(input.title);
      const existing = (documents ?? []).find(
        (doc) => isCreatableKind(doc.kind) && normalizeTitleKey(doc.title) === wanted,
      );
      // An ink note is born with its header and no text layer; the host writes
      // the first page's chunk when there is a first stroke.
      const body = input.ink ? writeInkNoteBody(defaultInkNoteMeta(), "") : undefined;
      const id = existing
        ? existing.id
        : (
            await getContainer().vault.manageVaultPage.add({
              title: input.title,
              parentId: input.parentId,
              ...(body !== undefined ? { body } : {}),
            })
          ).id;
      if (!existing) await reload();
      const kind = existing ? existing.kind : input.ink ? "ink_page" : "vault_page";
      if (opts.open !== false) apply(openTab(layout, { kind, id }));
    },
    [apply, documents, layout, reload],
  );

  /**
   * The explorer's draft row, submitted. A note or folder goes through
   * `createNote` — a folder *is* a note, one that will hold children — and a
   * section through the report's use case. A failure (a duplicate title, an
   * empty one) rejects, and the panel prints it under the row.
   */
  const createFromDraft = useCallback(
    async (target: Draft, title: string) => {
      if (target.root === "report") {
        const section = await getContainer().report.manageReportSection.add({
          title,
          parentId: target.parentId ?? undefined,
        });
        await reload();
        apply(openTab(layout, { kind: "report_section", id: section.id }));
        return;
      }
      const makes = draftMakes(target.kind);
      await createNote(
        { title, parentId: target.parentId ?? undefined, ink: makes.ink },
        { open: makes.opens },
      );
    },
    [apply, createNote, layout, reload],
  );

  const renameNode = useCallback(
    async (node: WorkspaceTreeNode, title: string) => {
      if (!node.id) return;
      // Which surface owns this kind is the table's answer, not a condition
      // here: a section is renamed by the report, every other document by the
      // vault (§3.3).
      if (kindOwner(node.kind) === "report") {
        await getContainer().report.manageReportSection.setTitle(node.id, title);
      } else {
        await getContainer().vault.manageVaultPage.update(node.id, { title });
      }
      await reload();
    },
    [reload],
  );

  const moveNode = useCallback(
    async (node: WorkspaceTreeNode, parentId: string | null) => {
      if (!node.id) return;
      if (kindOwner(node.kind) === "report") {
        await getContainer().report.manageReportSection.setParent(node.id, parentId);
      } else {
        await getContainer().vault.manageVaultPage.update(node.id, { parentId });
      }
      await reload();
    },
    [reload],
  );

  const createFromLink = useCallback(
    (title: string, opts?: { open?: boolean }) => {
      void createNote({ title }, opts).catch((err) => setError(formatError(err)));
    },
    [createNote],
  );

  // Fetch a note's full body the first time a tab needs it. The summary the
  // set was built from is a preview; an editor seeded from it would save the
  // cut back over the note.
  const hydrate = useCallback((tab: TabRef) => {
    if (hydratingRef.current.has(tab.id)) return;
    hydratingRef.current.add(tab.id);
    void getContainer()
      .vault.getPage(tab.id)
      .then((page) => {
        if (!page) return;
        hydratedRef.current.set(tab.id, page.body);
        setDocuments((current) =>
          (current ?? []).map((doc) =>
            doc.id === tab.id && doc.kind === tab.kind
              ? { ...doc, body: page.body, hydrated: true }
              : doc,
          ),
        );
      })
      .catch((err) => setError(formatError(err)))
      .finally(() => hydratingRef.current.delete(tab.id));
  }, []);

  const renderDocument = useCallback(
    (tab: TabRef) => {
      const key = tabKey(tab);
      const doc = byKey.get(key);
      if (!doc) return <p className="muted">This document is no longer in the workspace.</p>;
      if (!doc.hydrated) return <HydratingDocument tab={tab} hydrate={hydrate} />;
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
    [byKey, links, completions, tags, openLink, save, createMode, createFromLink, handleFor, hydrate],
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
      if (command === "toggle-explorer") return toggleExplorer();
      if (command === "toggle-focus") return toggleFocus();
      if (command === "new-note") {
        // Into the folder of the document on screen when it is a note or a
        // section; otherwise the top of Notes. Never Papers. Which kind that is
        // comes from the create table, so a new root states its own default.
        const doc = activeDocRef.current;
        const kind = creationKindFor(doc);
        setDraft({ kind, ...creationTarget(kind, doc) });
        return;
      }

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
  }, [apply, toggleExplorer, toggleFocus]);

  if (error && !documents) return <FormError>{error}</FormError>;
  if (!documents) return <p className="muted">Loading workspace…</p>;

  const activeDoc = activeKeyOf ? byKey.get(activeKeyOf) : undefined;
  activeDocRef.current = activeDoc;
  const activeTab = activeTabRef(layout);
  const activeMode = activeTab ? tabMode(activeTab) : undefined;
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
    <div
      className={`workspace-shell${explorerHidden ? " is-explorer-hidden" : ""}${focus ? " is-focus" : ""}`}
    >
      {focus ? (
        <button
          type="button"
          className="focus-exit"
          title="Exit focus (⌘⇧F)"
          aria-label="Exit focus"
          onClick={toggleFocus}
        >
          <FocusGlyph on />
        </button>
      ) : null}
      {explorerHidden ? (
        <button
          type="button"
          className="explorer-show"
          title="Show explorer (⌘B)"
          aria-label="Show explorer"
          onClick={toggleExplorer}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
        </button>
      ) : null}
      <ExplorerPanel
        sections={sections}
        activeKey={activeKeyOf}
        activeDoc={activeDoc}
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
        draft={draft}
        onDraft={setDraft}
        onCreate={createFromDraft}
        onRename={renameNode}
        onMove={moveNode}
        onHide={toggleExplorer}
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
        onToggleFocus={toggleFocus}
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
        segments={
          activeDoc
            ? segmentsFor(activeMode === "ink" && hasInkView(activeDoc.kind) ? "ink_page" : activeDoc.kind)
            : []
        }
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

/**
 * What a tab shows while its note's full body is on the way. Asking from an
 * effect rather than during render keeps the fetch off the render path and
 * runs it once per mount.
 */
function HydratingDocument({ tab, hydrate }: { tab: TabRef; hydrate: (tab: TabRef) => void }) {
  useEffect(() => {
    hydrate(tab);
  }, [tab, hydrate]);
  return <p className="muted">Loading…</p>;
}
