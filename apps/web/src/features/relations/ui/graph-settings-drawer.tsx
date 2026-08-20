"use client";

import { RELATION_TYPES, type ReadingList, type RelationType } from "@weaveforge/core";
import { MultiSelect } from "@/components/multi-select";
import { ChevronIcon } from "@/components/chevron-icon";
import { useState } from "react";
import {
  DEFAULT_GRAPH_SETTINGS,
  type ColorBy,
  type EdgeMode,
  type GraphViewSettings,
  type GroupBy,
  type LayoutMode,
} from "../application/graph-view-settings";

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="graph-drawer-section">
      <button
        type="button"
        className="graph-drawer-section-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {title}
        <ChevronIcon open={open} />
      </button>
      {open && <div className="graph-drawer-section-body">{children}</div>}
    </div>
  );
}

/** In-canvas settings drawer (Obsidian-style cog panel). */
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
  if (!open) return null;

  return (
    <>
      <button type="button" className="graph-drawer-backdrop" aria-label="Close settings" onClick={onClose} />
      <aside className="graph-settings-drawer card" aria-label="Graph settings">
        <div className="graph-drawer-head">
          <strong>Graph settings</strong>
          <button type="button" className="link-btn" onClick={onClose}>✕</button>
        </div>

        <Section title="Filters" defaultOpen>
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
          <div className="muted graph-drawer-label">Relation types</div>
          <div className="graph-check-grid">
            {RELATION_TYPES.map((t) => (
              <label key={t} className="graph-check">
                <input
                  type="checkbox"
                  className="themed-check"
                  checked={settings.relationTypes.includes(t)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...settings.relationTypes, t]
                      : settings.relationTypes.filter((x) => x !== t);
                    onChange({ relationTypes: next.length ? next : ["cites"] });
                  }}
                />
                {t.replace("_", " ")}
              </label>
            ))}
          </div>
        </Section>

        <Section title="Local graph" defaultOpen={!!localSeed} key={localSeed ?? "global"}>
          <p className="muted">
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
          <button type="button" className="btn-secondary" onClick={onResetLocal} disabled={!localSeed}>
            Show all papers
          </button>
        </Section>

        <Section title="Layout">
          <div className="seg" role="group" aria-label="Layout">
            {(["force", "timeline"] as LayoutMode[]).map((l) => (
              <button
                key={l}
                type="button"
                className={`seg-btn${settings.layout === l ? " on" : ""}`}
                onClick={() => onChange({ layout: l })}
              >
                {l}
              </button>
            ))}
          </div>
          <p className="muted">
            Timeline pins each paper to its publication year, left to right. Papers with
            no year recorded stay where the forces put them.
          </p>
        </Section>

        <Section title="Groups">
          <div className="seg" role="group" aria-label="Group by">
            {(["none", "status", "list"] as GroupBy[]).map((g) => (
              <button
                key={g}
                type="button"
                className={`seg-btn${settings.groupBy === g ? " on" : ""}`}
                onClick={() => onChange({ groupBy: g, colorBy: g === "list" ? "list" : settings.colorBy })}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Color by">
            {(["status", "tag", "list"] as ColorBy[]).map((c) => (
              <button
                key={c}
                type="button"
                className={`seg-btn${settings.colorBy === c ? " on" : ""}`}
                onClick={() => onChange({ colorBy: c })}
              >
                {c}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Display">
          <div className="seg" role="group" aria-label="Edges">
            {(["cites", "tags", "both"] as EdgeMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`seg-btn${settings.edgeMode === m ? " on" : ""}`}
                onClick={() => onChange({ edgeMode: m })}
              >
                {m}
              </button>
            ))}
          </div>
          <label className="graph-check">
            <input
              type="checkbox"
              className="themed-check"
              checked={settings.showAutoStyle}
              onChange={(e) => onChange({ showAutoStyle: e.target.checked })}
            />
            Dashed auto edges
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
          <label className="graph-slider-row">
            Node size: {settings.nodeSize.toFixed(1)}
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
          {pinnedCount > 0 && (
            <button type="button" className="btn-secondary" onClick={onUnpinAll}>
              Unpin all ({pinnedCount})
            </button>
          )}
        </Section>

        <Section title="Forces">
          <label className="graph-slider-row">
            Center: {settings.centerStrength.toFixed(2)}
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
            Repel: {settings.chargeStrength}
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
            onClick={() => onChange({
              centerStrength: DEFAULT_GRAPH_SETTINGS.centerStrength,
              chargeStrength: DEFAULT_GRAPH_SETTINGS.chargeStrength,
              linkDistance: DEFAULT_GRAPH_SETTINGS.linkDistance,
            })}
          >
            Reset forces
          </button>
        </Section>

        <Section title="Export">
          <button type="button" className="btn-secondary" onClick={onExport}>
            Export visible papers
          </button>
        </Section>
      </aside>
    </>
  );
}
