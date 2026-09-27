"use client";

import { useState } from "react";
import { RELATION_TYPES, type GraphViewSettings, type RelationType } from "@weaveforge/core";
import { ChevronIcon } from "@/components/chevron-icon";
import { RELATION_COLORS, WIKILINK_COLOR, EXPERIMENT_LINK_COLOR } from "../domain/graph-palette";
import { CLUSTER_PALETTE, RAMP_GRADIENT, UNCOLOURED } from "../application/node-colouring";
import { NODE_COLOR_LABELS, useGraphColours } from "./graph-colours";

/** Modes that colour every node from the whole graph; kinds then show by shape alone. */
const GRAPH_WIDE = new Set(["year", "degree", "cluster", "groups"]);

const RAMP_ENDS: Record<string, [string, string]> = {
  year: ["older", "newer"],
  degree: ["few links", "many links"],
};

type Shape = "circle" | "square" | "diamond" | "round" | "ring";

/** A node swatch in the shape the canvas draws for that kind, in every theme. */
function NodeSwatch({ shape, colour }: { shape: Shape; colour?: string }) {
  return <span className={`legend-node legend-node--${shape}`} style={colour ? { background: colour, color: colour } : undefined} />;
}

/** Collapsible legend for the graph view: node shapes and colours, then edges. */
export function GraphLegend({
  settings,
}: {
  settings: Pick<GraphViewSettings, "showConcepts" | "colorBy" | "nodePalette" | "nodeColors" | "colorGroups">;
}) {
  const showConcepts = settings.showConcepts;
  const { byKey } = useGraphColours(settings);
  const [open, setOpen] = useState(false);
  const wide = GRAPH_WIDE.has(settings.colorBy);
  return (
    <div className="graph-legend-wrap">
      <button
        type="button"
        className={`graph-legend-toggle btn-secondary${open ? " on" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Legend
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="graph-legend card">
          <div className="graph-legend-group">
            <span className="muted graph-legend-heading">Nodes</span>
            {settings.colorBy === "status" ? (
              (["to_read", "reading", "read", "skimmed"] as const).map((k) => (
                <span key={k} className="legend-item"><NodeSwatch shape="circle" colour={byKey[k]} /> {NODE_COLOR_LABELS[k].toLowerCase()} paper</span>
              ))
            ) : settings.colorBy === "type" ? (
              <span className="legend-item"><NodeSwatch shape="circle" colour={byKey.paper} /> paper</span>
            ) : (
              <span className="legend-item"><NodeSwatch shape="circle" /> paper{wide ? "" : `, by ${settings.colorBy}`}</span>
            )}
            <span className="legend-item"><NodeSwatch shape="diamond" colour={wide ? undefined : byKey.note} /> note</span>
            <span className="legend-item"><NodeSwatch shape="round" colour={wide ? undefined : byKey.report} /> report</span>
            <span className="legend-item"><NodeSwatch shape="ring" colour={wide ? undefined : byKey.experiment} /> experiment</span>
          </div>
          {wide && (
            <div className="graph-legend-group">
              <span className="muted graph-legend-heading">Colour</span>
              {RAMP_ENDS[settings.colorBy] && (
                <span className="legend-item legend-ramp-row">
                  {RAMP_ENDS[settings.colorBy]![0]}
                  <span className="legend-ramp" style={{ background: RAMP_GRADIENT }} />
                  {RAMP_ENDS[settings.colorBy]![1]}
                </span>
              )}
              {settings.colorBy === "cluster" && (
                <span className="legend-item">
                  {CLUSTER_PALETTE.slice(0, 5).map((c) => <span key={c} className="legend-swatch legend-dot" style={{ background: c }} />)}
                  one colour per linked cluster
                </span>
              )}
              {settings.colorBy === "groups" && settings.colorGroups.map((g, i) => (
                <span key={i} className="legend-item"><span className="legend-swatch legend-dot" style={{ background: g.color }} /> {g.query || "(empty rule)"}</span>
              ))}
              <span className="legend-item">
                <span className="legend-swatch legend-dot" style={{ background: UNCOLOURED }} />
                {settings.colorBy === "year" ? "no year" : settings.colorBy === "groups" ? "no match" : settings.colorBy === "cluster" ? "unlinked" : "no links"}
              </span>
            </div>
          )}
          <div className="graph-legend-group">
            <span className="muted graph-legend-heading">Relations</span>
            {RELATION_TYPES.map((t) => (
              <span key={t} className="legend-item">
                <span className="legend-swatch" style={{ background: RELATION_COLORS[t as RelationType] }} />
                {t.replace("_", " ")}
              </span>
            ))}
          </div>
          {showConcepts && (
            <div className="graph-legend-group">
              <span className="muted graph-legend-heading">Concepts</span>
              <span className="legend-item"><NodeSwatch shape="square" /> #tag node</span>
              <span className="legend-item"><span className="legend-swatch legend-concept" /> item ↔ concept</span>
            </div>
          )}
          <div className="graph-legend-group">
            <span className="muted graph-legend-heading">Links</span>
            <span className="legend-item"><span className="legend-swatch" style={{ background: WIKILINK_COLOR }} /> [[wikilink]]</span>
            <span className="legend-item"><span className="legend-swatch" style={{ background: EXPERIMENT_LINK_COLOR }} /> experiment → paper</span>
          </div>
        </div>
      )}
    </div>
  );
}
