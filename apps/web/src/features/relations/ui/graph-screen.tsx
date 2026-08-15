"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Paper, PaperRelation, ReadingList, ReportSection, VaultPage } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ScreenLoading } from "@/components/screen-loading";
import { useProject } from "@/features/projects";
import { AddEdgeForm } from "./add-edge-form";
import { BraveGraphWarning } from "./brave-graph-warning";
import { GraphCanvas } from "./graph-canvas";
import type { GNode } from "../application/build-graph-data";
import { SettingsIcon } from "@/components/view-icons";
import { GraphLegend } from "./graph-legend";
import { GraphSettingsDrawer } from "./graph-settings-drawer";
import { GraphSidePanel } from "./graph-side-panel";
import { graphFilterCount } from "../application/graph-view-settings";
import { useGraphPersistedState } from "../application/use-graph-persisted-state";
import { useScreenData } from "@/lib/use-screen-data";
import { emptyArray, emptyMap } from "@/lib/empty";
import type { GraphScreenData } from "@/container/facades";
import { formatError } from "@/lib/format-error";

/** Graph screen — data loading, view-state, and child presentation components. */
export function GraphScreen() {
  const { current: project } = useProject();
  const {
    settings,
    patchSettings,
    selectedLists,
    setSelectedLists,
    selectedTags,
    setSelectedTags,
    localSeed,
    setLocalSeed,
    localDepth,
    setLocalDepth,
    pinned,
    setPinned,
    handlePinToggle,
    resetLocalGraph: resetPersistedLocalGraph,
    error: settingsError,
  } = useGraphPersistedState(project?.id);
  const loadScreen = useCallback(
    (): Promise<GraphScreenData> => getContainer().graph.loadScreenData(),
    [],
  );

  const { data, loading, error: loadError, reload: load } = useScreenData("graph", loadScreen);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(loadError ?? settingsError);
  }, [loadError, settingsError]);

  const papers = data?.papers ?? emptyArray<Paper>();
  const notes = data?.notes ?? emptyArray<VaultPage>();
  const sections = data?.sections ?? emptyArray<ReportSection>();
  const edges = data?.relations ?? emptyArray<PaperRelation>();
  const lists = data?.lists ?? emptyArray<ReadingList>();
  const membership = data?.membership ?? emptyMap<string, Set<string>>();
  const [linking, setLinking] = useState(false);
  const [linkMsg, setLinkMsg] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<"menu" | "edge">("menu");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [selectedConcept, setSelectedConcept] = useState<string | null>(null);
  const [tagToPapers, setTagToPapers] = useState<Map<string, string[]>>(new Map());
  const [tagToNotes, setTagToNotes] = useState<Map<string, string[]>>(new Map());

  useEffect(() => {
    if (!focus) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [focus]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const p of papers) for (const t of p.tags) set.add(t);
    for (const n of notes) {
      const body = `${n.title}\n${n.body}`;
      for (const m of body.match(/#[\p{L}\p{N}_-]+/gu) ?? []) {
        set.add(m.replace(/^#+/, "").toLowerCase());
      }
    }
    return [...set].sort();
  }, [papers, notes]);

  const visiblePapers = useMemo(() => {
    if (selectedLists.length === 0 && selectedTags.length === 0) return papers;
    const allowed = new Set<string>();
    for (const listId of selectedLists) membership.get(listId)?.forEach((pid) => allowed.add(pid));
    return papers.filter(
      (p) =>
        (selectedLists.length === 0 || allowed.has(p.id)) &&
        (selectedTags.length === 0 || selectedTags.some((t) => p.tags.includes(t))),
    );
  }, [papers, selectedLists, selectedTags, membership]);

  const visibleEdges = useMemo(() => {
    const shown = new Set(visiblePapers.map((p) => p.id));
    return edges.filter((e) => shown.has(e.fromPaper) && shown.has(e.toPaper));
  }, [edges, visiblePapers]);

  const visibleNotes = useMemo(() => {
    if (selectedTags.length === 0) return notes;
    return notes.filter((n) => {
      const body = `${n.title}\n${n.body}`.toLowerCase();
      return selectedTags.some((t) => body.includes(`#${t}`));
    });
  }, [notes, selectedTags]);

  const hasGraphItems = papers.length > 0 || notes.length > 0 || sections.length > 0;
  const hasVisibleItems = visiblePapers.length > 0 || visibleNotes.length > 0 || sections.length > 0;

  const activeFilters = graphFilterCount(selectedTags, selectedLists, settings);
  const selectedPaper = selectedPaperId ? papers.find((p) => p.id === selectedPaperId) ?? null : null;
  const selectedNote = selectedNoteId ? notes.find((n) => n.id === selectedNoteId) ?? null : null;
  const selectedSection = selectedSectionId
    ? sections.find((s) => s.id === selectedSectionId) ?? null
    : null;

  async function autoLink() {
    setLinking(true);
    setLinkMsg(null);
    setError(null);
    try {
      const { created } = await getContainer().graph.linkCitations.forAll(papers);
      setLinkMsg(
        created.length > 0
          ? `Added ${created.length} citation edge${created.length === 1 ? "" : "s"}.`
          : "No new citation edges found among your papers.",
      );
      await load();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLinking(false);
    }
  }

  function handleNodeClick(node: GNode) {
    if (node.kind === "tag") {
      const name = node.tagName ?? node.id.replace(/^tag:/, "");
      setSelectedConcept(name);
      setSelectedPaperId(null);
      setSelectedNoteId(null);
      setSelectedSectionId(null);
      setLocalSeed(node.id);
      return;
    }
    if (node.kind === "report" || node.sectionId) {
      const sectionId = node.sectionId ?? node.id;
      setSelectedSectionId(sectionId);
      setSelectedPaperId(null);
      setSelectedNoteId(null);
      setSelectedConcept(null);
      setLocalSeed(sectionId);
      return;
    }
    if (node.kind === "note" || node.noteId) {
      const noteId = node.noteId ?? node.id;
      setSelectedNoteId(noteId);
      setSelectedPaperId(null);
      setSelectedSectionId(null);
      setSelectedConcept(null);
      setLocalSeed(noteId);
      return;
    }
    if (node.kind === "paper" || node.paperId || !node.id.startsWith("tag:")) {
      const paperId = node.paperId ?? node.id;
      setSelectedPaperId(paperId);
      setSelectedNoteId(null);
      setSelectedSectionId(null);
      setSelectedConcept(null);
      setLocalSeed(paperId);
    }
  }

  function resetLocalGraph() {
    resetPersistedLocalGraph();
    setSelectedPaperId(null);
    setSelectedNoteId(null);
    setSelectedSectionId(null);
    setSelectedConcept(null);
  }

  function exportVisiblePapers() {
    const lines = visiblePapers.map((p) => `- ${p.title} (${p.status})`);
    const blob = new Blob([`# Graph export\n\n${lines.join("\n")}\n`], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "graph-papers.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  const header = (
    <header className={`screen-head${focus ? " graph-focus-head" : ""}`}>
      <div className="head-row">
        <div className="screen-actions">
          <button
            className="btn-primary"
            type="button"
            disabled={linking}
            onClick={() => { setComposeMode("menu"); setComposeOpen(true); }}
          >
            {linking ? "Linking…" : "+ Graph"}
          </button>
        </div>
      </div>
    </header>
  );

  const canvas = !loading && hasVisibleItems ? (
    <GraphCanvas
      papers={visiblePapers}
      notes={visibleNotes}
      sections={sections}
      relations={visibleEdges}
      settings={settings}
      membership={membership}
      lists={lists}
      fill={focus}
      localSeed={localSeed}
      localDepth={localDepth}
      pinned={pinned}
      onPinToggle={handlePinToggle}
      onNodeClick={handleNodeClick}
      onTagToPapers={setTagToPapers}
      onTagToNotes={setTagToNotes}
      onRefresh={load}
    />
  ) : null;

  const settingsDrawer = (
    <GraphSettingsDrawer
      open={drawerOpen}
      onClose={() => setDrawerOpen(false)}
      settings={settings}
      onChange={patchSettings}
      allTags={allTags}
      lists={lists}
      selectedTags={selectedTags}
      selectedLists={selectedLists}
      onTagsChange={setSelectedTags}
      onListsChange={setSelectedLists}
      localSeed={localSeed}
      localDepth={localDepth}
      onLocalDepthChange={setLocalDepth}
      onResetLocal={resetLocalGraph}
      pinnedCount={pinned.size}
      onUnpinAll={() => setPinned(new Map())}
      onExport={exportVisiblePapers}
    />
  );

  const localBanner = localSeed ? (
    <div className="graph-local-banner">
      <span>Local graph · depth {localDepth}</span>
      <button type="button" className="link-btn" onClick={resetLocalGraph}>
        Show all
      </button>
    </div>
  ) : null;

  const settingsButton = (
    <button
      type="button"
      className={`entity-icon-btn graph-stage-settings${drawerOpen ? " is-active" : ""}`}
      aria-label="Graph settings"
      aria-expanded={drawerOpen}
      title="Graph settings"
      onClick={() => setDrawerOpen(true)}
    >
      <SettingsIcon />
      {activeFilters > 0 && (
        <span className="graph-settings-count" aria-hidden>
          {activeFilters}
        </span>
      )}
    </button>
  );

  const graphView = hasGraphItems ? (
    <div className={`graph-stage${canvas ? "" : " graph-stage--empty"}`}>
      {!focus && (
        <div className="graph-stage-bar">
          {settingsButton}
          {canvas && (
            <button type="button" className="graph-focus-btn btn-secondary" onClick={() => setFocus(true)}>
              Focus
            </button>
          )}
        </div>
      )}
      {localBanner}
      {canvas}
      {canvas && (selectedPaper || selectedNote || selectedSection || selectedConcept) && (
        <GraphSidePanel
          paper={selectedPaper}
          note={selectedNote}
          section={selectedSection}
          conceptName={selectedConcept}
          papers={visiblePapers}
          notes={visibleNotes}
          relations={visibleEdges}
          tagToPapers={tagToPapers}
          tagToNotes={tagToNotes}
          onClose={() => {
            setSelectedPaperId(null);
            setSelectedNoteId(null);
            setSelectedSectionId(null);
            setSelectedConcept(null);
          }}
          onRefresh={load}
          onSelectPaper={(id) => {
            setSelectedPaperId(id);
            setSelectedNoteId(null);
            setSelectedSectionId(null);
            setSelectedConcept(null);
            setLocalSeed(id);
          }}
          onSelectNote={(id) => {
            setSelectedNoteId(id);
            setSelectedPaperId(null);
            setSelectedSectionId(null);
            setSelectedConcept(null);
            setLocalSeed(id);
          }}
          onSelectConcept={(name) => {
            setSelectedConcept(name);
            setSelectedPaperId(null);
            setSelectedNoteId(null);
            setSelectedSectionId(null);
            setLocalSeed(`tag:${name}`);
          }}
        />
      )}
    </div>
  ) : null;

  const addEdgeModal = composeOpen && (
    <Modal
      title={composeMode === "edge" ? "Add edge" : "Graph actions"}
      onClose={() => { setComposeOpen(false); setComposeMode("menu"); }}
    >
      {composeMode === "menu" ? (
        <div className="org-modal-choices">
          <button
            type="button"
            className="org-choice-card"
            disabled={papers.length < 2}
            onClick={() => setComposeMode("edge")}
          >
            <span className="org-choice-title">Add edge</span>
            <p className="org-choice-desc">Manually link two papers with a relation.</p>
          </button>
          <button
            type="button"
            className="org-choice-card"
            disabled={linking || papers.length === 0}
            onClick={() => {
              setComposeOpen(false);
              setComposeMode("menu");
              void autoLink();
            }}
          >
            <span className="org-choice-title">Auto-link</span>
            <p className="org-choice-desc">Create citation edges from paper bibliographies.</p>
          </button>
        </div>
      ) : (
        <AddEdgeForm
          papers={papers}
          onAdded={load}
          onClose={() => { setComposeOpen(false); setComposeMode("menu"); }}
        />
      )}
    </Modal>
  );

  if (loading) {
    return <ScreenLoading status="Loading citation graph…" />;
  }

  if (focus) {
    return (
      <div className="graph-focus">
        <div className="graph-focus-bar">
          <div className="graph-focus-bar__row">
            {header}
            {settingsButton}
            <button type="button" className="btn-secondary" onClick={() => setFocus(false)}>Exit focus</button>
          </div>
          <BraveGraphWarning />
        </div>
        {settingsDrawer}
        {graphView}
        {!hasVisibleItems && (
          <div className="empty gf-empty"><p>No items match the filter.</p></div>
        )}
        <div className="graph-focus-legend"><GraphLegend showConcepts={settings.showConcepts} /></div>
        {addEdgeModal}
      </div>
    );
  }

  return (
    <section className="screen screen--wide">
      {header}
      {settingsDrawer}
      {addEdgeModal}
      <BraveGraphWarning />
      {error && <p className="error">{error}</p>}
      {linkMsg && <p className="muted">{linkMsg}</p>}
      {!hasGraphItems && (
        <div className="empty"><p>Add papers or notes first, then link them here.</p></div>
      )}
      {hasGraphItems && !hasVisibleItems && (
        <div className="empty"><p>No items match the filter.</p></div>
      )}
      {graphView}
      {hasVisibleItems && <GraphLegend showConcepts={settings.showConcepts} />}
    </section>
  );
}
