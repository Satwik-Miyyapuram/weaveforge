"use client";

import { useState } from "react";
import { RELATION_TYPES, type RelationType } from "@weaveforge/core";
import { ChevronIcon } from "@/components/chevron-icon";
import { RELATION_COLORS, NOTE_COLOR, REPORT_COLOR, WIKILINK_COLOR } from "../application/build-graph-data";

/** Collapsible relation-type + concept legend for the graph view. */
export function GraphLegend({ showConcepts = false }: { showConcepts?: boolean }) {
  const [open, setOpen] = useState(false);
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
              <span className="legend-item"><span className="legend-swatch legend-tag" /> #tag node</span>
              <span className="legend-item"><span className="legend-swatch legend-concept" /> item ↔ concept</span>
            </div>
          )}
          <div className="graph-legend-group">
            <span className="muted graph-legend-heading">Nodes</span>
            <span className="legend-item"><span className="legend-swatch" style={{ background: NOTE_COLOR, transform: "rotate(45deg)" }} /> note</span>
            <span className="legend-item"><span className="legend-swatch" style={{ background: REPORT_COLOR, borderRadius: 3 }} /> report</span>
          </div>
          <div className="graph-legend-group">
            <span className="muted graph-legend-heading">Links</span>
            <span className="legend-item"><span className="legend-swatch" style={{ background: WIKILINK_COLOR }} /> [[wikilink]]</span>
          </div>
        </div>
      )}
    </div>
  );
}
