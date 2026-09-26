"use client";

import { useState } from "react";
import {
  MAX_COLOR_GROUPS,
  NODE_COLOR_KEYS,
  type ColorBy,
  type ColorGroup,
  type GraphViewSettings,
  type NodePalette,
} from "@weaveforge/core";
import { ChevronIcon } from "@/components/chevron-icon";
import { ColourMenu } from "@/components/colour-menu";
import { Select } from "@/components/select";
import { CLUSTER_PALETTE } from "../application/node-colouring";
import { NODE_COLOR_LABELS, useGraphColours } from "./graph-colours";

/** Swatches offered for a node colour; any other comes through the native picker. */
const NODE_SWATCHES = [
  "#86d08f", "#8fb8ff", "#ffb86b", "#ff9ecb", "#ffe066", "#c9a7ff",
  "#7c9885", "#5a7d8c", "#c98a6b", "#b06a4e", "#a0896a", "#b9b2a6",
] as const;

const STATUS_KEYS = new Set<string>(["to_read", "reading", "read", "skimmed"]);

/** Each colour mode, and the line that says what it shows. */
const COLOR_MODES: Array<{ value: ColorBy; label: string; hint: string }> = [
  { value: "status", label: "Reading status", hint: "Papers by to read, reading, read or skimmed." },
  { value: "type", label: "Type", hint: "One colour per kind: paper, note, report, experiment." },
  { value: "tag", label: "First tag", hint: "Papers by their first tag, the same hue as the tag." },
  { value: "list", label: "Reading list", hint: "Papers by the first list they are in." },
  { value: "year", label: "Publication year", hint: "Pale for older papers, deep for newer. No year stays grey." },
  { value: "degree", label: "Connections", hint: "Deeper the more links a node has, so hubs stand out." },
  { value: "cluster", label: "Clusters", hint: "Each densely linked group of nodes gets its own colour." },
  { value: "groups", label: "Custom groups", hint: "Your own rules, first match wins. Nothing matched stays grey." },
];

/** Colour-by modes that use the per-kind colours below. */
const USES_KIND_COLOURS = new Set<ColorBy>(["status", "type", "tag", "list"]);

export function Section({
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

/** The rules for "Custom groups": a query and a colour each, in priority order. */
function GroupRules({
  groups,
  onChange,
}: {
  groups: ColorGroup[];
  onChange: (groups: ColorGroup[]) => void;
}) {
  const set = (i: number, patch: Partial<ColorGroup>) =>
    onChange(groups.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  return (
    <>
      <ul className="graph-group-list">
        {groups.map((g, i) => (
          <li key={i} className="graph-group-row">
            <input
              className="input"
              value={g.query}
              placeholder="tag:ml, list:thesis, status:read or words"
              aria-label={`Group ${i + 1} rule`}
              onChange={(e) => set(i, { query: e.target.value })}
            />
            <ColourMenu
              value={g.color}
              palette={NODE_SWATCHES}
              ariaLabel={`Group ${i + 1} colour`}
              onChange={(color) => set(i, { color })}
            />
            <button
              type="button"
              className="btn-ghost btn-sm"
              aria-label={`Remove group ${i + 1}`}
              onClick={() => onChange(groups.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {groups.length < MAX_COLOR_GROUPS && (
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() =>
            onChange([...groups, { query: "", color: CLUSTER_PALETTE[groups.length % CLUSTER_PALETTE.length]! }])
          }
        >
          Add group
        </button>
      )}
    </>
  );
}

/** What node colours mean, the palette, and per-kind overrides. Shapes are fixed. */
export function ColourSection({
  settings,
  onChange,
}: {
  settings: GraphViewSettings;
  onChange: (patch: Partial<GraphViewSettings>) => void;
}) {
  const { byKey } = useGraphColours(settings);
  const overridden = Object.keys(settings.nodeColors).length > 0;
  const mode = COLOR_MODES.find((m) => m.value === settings.colorBy) ?? COLOR_MODES[0]!;
  return (
    <Section title="Colours">
      <Select
        value={settings.colorBy}
        aria-label="Colour nodes by"
        onChange={(e) => onChange({ colorBy: e.target.value as ColorBy })}
      >
        {COLOR_MODES.map((m) => (
          <option key={m.value} value={m.value}>{m.label}</option>
        ))}
      </Select>
      <p className="muted">{mode.hint}</p>
      {settings.colorBy === "groups" && (
        <GroupRules groups={settings.colorGroups} onChange={(colorGroups) => onChange({ colorGroups })} />
      )}
      {USES_KIND_COLOURS.has(settings.colorBy) && (
        <>
          <div className="seg" role="group" aria-label="Node palette">
            {(["theme", "classic"] as NodePalette[]).map((p) => (
              <button
                key={p}
                type="button"
                className={`seg-btn${settings.nodePalette === p ? " on" : ""}`}
                onClick={() => onChange({ nodePalette: p })}
              >
                {p === "theme" ? "Theme" : "Classic"}
              </button>
            ))}
          </div>
          <ul className="graph-colour-list">
            {NODE_COLOR_KEYS.map((key) => (
              <li key={key} className="graph-colour-row">
                <span>{NODE_COLOR_LABELS[key]}{STATUS_KEYS.has(key) ? " paper" : ""}</span>
                <ColourMenu
                  value={byKey[key]}
                  palette={NODE_SWATCHES}
                  ariaLabel={`${NODE_COLOR_LABELS[key]} colour`}
                  onChange={(colour) => onChange({ nodeColors: { ...settings.nodeColors, [key]: colour } })}
                />
              </li>
            ))}
          </ul>
          {overridden && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => onChange({ nodeColors: {} })}>
              Reset colours
            </button>
          )}
        </>
      )}
      <p className="muted">
        Each kind keeps its shape whatever its colour: circle for papers, diamond for notes,
        rounded square for reports, a ringed circle for runs.
      </p>
    </Section>
  );
}
