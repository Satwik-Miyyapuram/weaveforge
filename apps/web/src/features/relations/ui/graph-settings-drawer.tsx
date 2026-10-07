"use client";

import { useState } from "react";
import {
  DEFAULT_GRAPH_SETTINGS,
  RELATION_TYPES,
  type EdgeMode,
  type GraphViewSettings,
  type GroupBy,
  type LayoutMode,
  type ReadingList,
} from "@weaveforge/core";
import { MultiSelect } from "@/components/multi-select";
import { ColourSection } from "./graph-colour-section";

type SettingsTab = "filters" | "appearance" | "physics" | "actions";

/** In-canvas settings drawer (clean 4-tab panel). */
export function GraphSettingsDrawer({
  open,
  onClose,
  settings,
  onChange,
  allTags,
  lists,
  selectedTags,
  selectedLists,
  onTagsChange,
  onListsChange,
  localSeed,
  localDepth,
  onLocalDepthChange,
  onResetLocal,
  pinnedCount,
  onUnpinAll,
  onExport,
}: {
  open: boolean;
  onClose: () => void;
  settings: GraphViewSettings;
  onChange: (patch: Partial<GraphViewSettings>) => void;
  allTags: string[];
  lists: ReadingList[];
  selectedTags: string[];
  selectedLists: string[];
  onTagsChange: (next: string[]) => void;
  onListsChange: (next: string[]) => void;
  localSeed: string | null;
  localDepth: number;
  onLocalDepthChange: (d: number) => void;
  onResetLocal: () => void;
  pinnedCount: number;
  onUnpinAll: () => void;
  onExport: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>("filters");

  if (!open) return null;

  return (
    <>
      <button type="button" className="graph-drawer-backdrop" aria-label="Close settings" onClick={onClose} />
      <div className="graph-settings-shell">
        <aside className="graph-settings-drawer card" aria-label="Graph settings">
          <div className="graph-drawer-head">
            <strong>Graph settings</strong>
            <button type="button" className="link-btn graph-drawer-close" onClick={onClose}>✕</button>
          </div>

          <div className="graph-drawer-tabs" role="tablist" aria-label="Settings categories">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "filters"}
              className={`graph-drawer-tab${tab === "filters" ? " active" : ""}`}
              onClick={() => setTab("filters")}
            >
              Filters
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "appearance"}
              className={`graph-drawer-tab${tab === "appearance" ? " active" : ""}`}
              onClick={() => setTab("appearance")}
            >
              Appearance
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "physics"}
              className={`graph-drawer-tab${tab === "physics" ? " active" : ""}`}
              onClick={() => setTab("physics")}
            >
              Physics
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "actions"}
              className={`graph-drawer-tab${tab === "actions" ? " active" : ""}`}
              onClick={() => setTab("actions")}
            >
              Actions
            </button>
          </div>

          {tab === "filters" && (
            <div className="graph-tab-panel" role="tabpanel" aria-label="Filters">
              <input
                type="search"
                className="graph-search-input"
                placeholder="Search nodes…"
                value={settings.searchQuery}
                onChange={(e) => onChange({ searchQuery: e.target.value })}
                aria-label="Search graph"
              />
              {allTags.length > 0 && (
                <MultiSelect
                  id="gd-tags"
                  values={selectedTags}
                  onChange={onTagsChange}
                  allLabel="All tags"
                  ariaLabel="Filter by tags"
                  options={allTags.map((t) => ({ value: t, label: `#${t}` }))}
                />
              )}
              {lists.length > 0 && (
                <MultiSelect
                  id="gd-lists"
                  values={selectedLists}
                  onChange={onListsChange}
                  allLabel="All lists"
                  ariaLabel="Filter by lists"
                  options={lists.map((l) => ({ value: l.id, label: l.name }))}
                />
              )}
              <label className="graph-check">
                <input
                  type="checkbox"
                  className="themed-check"
                  checked={settings.hideOrphans}
                  onChange={(e) => onChange({ hideOrphans: e.target.checked })}
                />
                Hide orphan papers
              </label>
              <label className="graph-check">
                <input
                  type="checkbox"
                  className="themed-check"
                  checked={settings.showConcepts}
                  onChange={(e) => onChange({ showConcepts: e.target.checked })}
                />
                Show concept (#tag) nodes
              </label>
              <label className="graph-check">
                <input
                  type="checkbox"
                  className="themed-check"
                  checked={settings.includeListsAsConcepts !== false}
                  onChange={(e) => onChange({ includeListsAsConcepts: e.target.checked })}
                />
                Include reading lists as tags
              </label>
              {settings.showConcepts && (
                <label className="graph-slider-row">
                  Min concept papers: {settings.minConceptDegree}
                  <input
                    type="range"
                    min={1}
                    max={6}
                    value={settings.minConceptDegree}
                    onChange={(e) => onChange({ minConceptDegree: Number(e.target.value) })}
                  />
                </label>
              )}
              <div className="graph-drawer-section">
                <div className="graph-chip-actions">
                  <span className="muted graph-drawer-label">Relation types</span>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      className="link-btn"
                      style={{ fontSize: "0.72rem" }}
                      onClick={() => onChange({ relationTypes: [...RELATION_TYPES] })}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className="link-btn"
                      style={{ fontSize: "0.72rem" }}
                      onClick={() => onChange({ relationTypes: ["cites"] })}
                    >
                      Cites only
                    </button>
                  </div>
                </div>
                <div className="graph-chip-grid" role="group" aria-label="Relation types">
                  {RELATION_TYPES.map((t) => {
                    const active = settings.relationTypes.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        className={`graph-chip${active ? " active" : ""}`}
                        aria-pressed={active}
                        onClick={() => {
                          const next = active
                            ? settings.relationTypes.filter((x) => x !== t)
                            : [...settings.relationTypes, t];
                          onChange({ relationTypes: next.length ? next : ["cites"] });
                        }}
                      >
                        {t.replace("_", " ")}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="graph-drawer-section">
                <span className="muted graph-drawer-label">Local neighborhood</span>
                <p className="muted" style={{ fontSize: "0.75rem", margin: "4px 0" }}>
                  {localSeed ? `Showing ${localDepth}-hop neighborhood.` : "Click a paper or concept to explore locally."}
                </p>
                <label className="graph-slider-row">
                  Depth: {localDepth}
                  <input
                    type="range"
                    min={1}
                    max={3}
                    value={localDepth}
                    onChange={(e) => onLocalDepthChange(Number(e.target.value))}
                    disabled={!localSeed}
                  />
                </label>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ marginTop: "4px" }}
                  onClick={onResetLocal}
                  disabled={!localSeed}
                >
                  Show all papers
                </button>
              </div>
            </div>
          )}

          {tab === "appearance" && (
            <div className="graph-tab-panel" role="tabpanel" aria-label="Appearance">
              <div>
                <div className="muted graph-drawer-label" style={{ marginBottom: "6px" }}>Edges</div>
                <div className="seg" role="group" aria-label="Edges">
                  {(["cites", "tags", "both"] as EdgeMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`seg-btn${settings.edgeMode === m ? " seg-on" : ""}`}
                      aria-pressed={settings.edgeMode === m}
                      onClick={() => onChange({ edgeMode: m })}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <label className="graph-check" style={{ marginTop: "8px" }}>
                  <input
                    type="checkbox"
                    className="themed-check"
                    checked={settings.showAutoStyle}
                    onChange={(e) => onChange({ showAutoStyle: e.target.checked })}
                  />
                  Dashed auto edges
                </label>
              </div>

              <div className="graph-drawer-section">
                <div className="muted graph-drawer-label" style={{ marginBottom: "6px" }}>Zoom & Sizing</div>
                <label className="graph-check">
                  <input
                    type="checkbox"
                    className="themed-check"
                    checked={settings.boundedZoomScale !== false}
                    onChange={(e) => onChange({ boundedZoomScale: e.target.checked })}
                  />
                  Bounded size on zoom
                </label>
                <label className="graph-slider-row">
                  Node base size: {settings.nodeSize.toFixed(1)}
                  <input
                    type="range"
                    min={0.6}
                    max={2}
                    step={0.1}
                    value={settings.nodeSize}
                    onChange={(e) => onChange({ nodeSize: Number(e.target.value) })}
                  />
                </label>
                <label className="graph-slider-row">
                  Link thickness: {settings.linkThickness.toFixed(1)}
                  <input
                    type="range"
                    min={0.5}
                    max={2.5}
                    step={0.1}
                    value={settings.linkThickness}
                    onChange={(e) => onChange({ linkThickness: Number(e.target.value) })}
                  />
                </label>
                <label className="graph-slider-row">
                  Text fade: {settings.textFadeThreshold.toFixed(2)}
                  <input
                    type="range"
                    min={0.2}
                    max={1.2}
                    step={0.05}
                    value={settings.textFadeThreshold}
                    onChange={(e) => onChange({ textFadeThreshold: Number(e.target.value) })}
                  />
                </label>
              </div>

              <div className="graph-drawer-section">
                <div className="muted graph-drawer-label" style={{ marginBottom: "6px" }}>Group by</div>
                <div className="seg" role="group" aria-label="Group by">
                  {(["none", "status", "list"] as GroupBy[]).map((g) => (
                    <button
                      key={g}
                      type="button"
                      className={`seg-btn${settings.groupBy === g ? " seg-on" : ""}`}
                      aria-pressed={settings.groupBy === g}
                      onClick={() => onChange({ groupBy: g, colorBy: g === "list" ? "list" : settings.colorBy })}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              <ColourSection settings={settings} onChange={onChange} />
            </div>
          )}

          {tab === "physics" && (
            <div className="graph-tab-panel" role="tabpanel" aria-label="Physics">
              <div>
                <div className="muted graph-drawer-label" style={{ marginBottom: "6px" }}>Layout</div>
                <div className="seg" role="group" aria-label="Layout">
                  {(["force", "timeline"] as LayoutMode[]).map((l) => (
                    <button
                      key={l}
                      type="button"
                      className={`seg-btn${settings.layout === l ? " seg-on" : ""}`}
                      aria-pressed={settings.layout === l}
                      onClick={() => onChange({ layout: l })}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <p className="muted" style={{ fontSize: "0.75rem", marginTop: "6px" }}>
                  Timeline pins each paper to its publication year, left to right. Papers with no year recorded stay where the forces put them.
                </p>
              </div>

              <div className="graph-drawer-section">
                <div className="muted graph-drawer-label" style={{ marginBottom: "6px" }}>Force Simulation</div>
                <label className="graph-slider-row">
                  Center gravity: {settings.centerStrength.toFixed(2)}
                  <input
                    type="range"
                    min={0}
                    max={0.3}
                    step={0.01}
                    value={settings.centerStrength}
                    onChange={(e) => onChange({ centerStrength: Number(e.target.value) })}
                  />
                </label>
                <label className="graph-slider-row">
                  Repulsion (charge): {settings.chargeStrength}
                  <input
                    type="range"
                    min={-120}
                    max={-4}
                    value={settings.chargeStrength}
                    onChange={(e) => onChange({ chargeStrength: Number(e.target.value) })}
                  />
                </label>
                <label className="graph-slider-row">
                  Link distance: {settings.linkDistance}
                  <input
                    type="range"
                    min={8}
                    max={80}
                    value={settings.linkDistance}
                    onChange={(e) => onChange({ linkDistance: Number(e.target.value) })}
                  />
                </label>
                <button
                  type="button"
                  className="link-btn"
                  style={{ marginTop: "4px" }}
                  onClick={() => onChange({
                    centerStrength: DEFAULT_GRAPH_SETTINGS.centerStrength,
                    chargeStrength: DEFAULT_GRAPH_SETTINGS.chargeStrength,
                    linkDistance: DEFAULT_GRAPH_SETTINGS.linkDistance,
                  })}
                >
                  Reset forces to default
                </button>
              </div>
            </div>
          )}

          {tab === "actions" && (
            <div className="graph-tab-panel" role="tabpanel" aria-label="Actions">
              <div className="graph-card-sub">
                <strong>Pinned Nodes</strong>
                <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>
                  Double-click or right-click any node on canvas to pin or unpin its position.
                </p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onUnpinAll}
                  disabled={pinnedCount === 0}
                >
                  {pinnedCount > 0 ? `Unpin all (${pinnedCount})` : "No pinned nodes"}
                </button>
              </div>

              <div className="graph-card-sub">
                <strong>Export</strong>
                <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>
                  Download a Markdown summary of the papers currently visible in this graph view.
                </p>
                <button type="button" className="btn-secondary" onClick={onExport}>
                  Export visible papers (.md)
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
