"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Layout, ResponsiveLayouts } from "react-grid-layout/legacy";
import { Responsive } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { getCardDef, isStatCard } from "../application/card-registry";
import { DESKTOP_BREAKPOINT_PX } from "@/lib/breakpoints";
import { getRglBreakpoint } from "@/lib/hooks/use-layout-breakpoint";
import type { DashboardLayout, DashboardLayoutItem } from "@weaveforge/core";
import {
  mergeRglPositions,
  normalizeSmLayout,
  compactLayoutVertical,
  normalizeLayoutItem,
  lgLayoutNeedsRepair,
  smLayoutNeedsRepack,
  layoutFloors,
  layoutSignature,
} from "../application/dashboard-layout";
import { DashboardCardBody } from "./cards/dashboard-card-body";
import type { DashboardStats } from "../application/build-dashboard-stats";
import type { SupervisionStats } from "../application/build-supervision-stats";
import type { Member } from "@weaveforge/core";

const BREAKPOINTS = { lg: DESKTOP_BREAKPOINT_PX, sm: 0 };
const COLS = { lg: 12, sm: 4 };
const ROW_HEIGHT = { lg: 48, sm: 48 };
const GRID_MARGIN = { lg: 8, sm: 8 };

/** Match --layout-duration in styles/base.css */
const LAYOUT_TRANSITION_MS = 320;
const CARD_ENTER_MS = 200;

function estimateGridHeight(
  items: readonly DashboardLayoutItem[],
  rowHeight: number,
  margin: number,
): number {
  if (items.length === 0) return 120;
  const rows = items.reduce((max, it) => Math.max(max, it.y + it.h), 0);
  return rows * rowHeight + Math.max(0, rows - 1) * margin + margin;
}

function toRgl(items: DashboardLayoutItem[], cols: number): Layout {
  return items.map((it) => {
    const def = getCardDef(it.type);
    const { minW, minH, maxW, maxH } = layoutFloors(def, cols);
    return {
      i: it.id,
      x: it.x,
      y: it.y,
      w: it.w,
      h: it.h,
      minW,
      minH,
      maxW,
      maxH,
    };
  });
}

export function DashboardGrid({
  layout,
  editing,
  stats,
  supervision,
  supervisees,
  cardsEntered,
  statsLoading,
  contentReady,
  onEnterComplete,
  onLayoutChange,
  onRemove,
  onSuperviseeConfig,
}: {
  layout: DashboardLayout;
  editing: boolean;
  stats: DashboardStats;
  supervision: SupervisionStats | null;
  supervisees: Member[];
  /** Layout + enter animation finished. */
  cardsEntered: boolean;
  statsLoading: boolean;
  /** Stats visible with progress animation. */
  contentReady: boolean;
  onEnterComplete?: () => void;
  onLayoutChange: (bp: "lg" | "sm", items: DashboardLayoutItem[]) => void;
  onRemove: (id: string) => void;
  onSuperviseeConfig: (cardId: string, memberId: string) => void;
}) {
  const [breakpoint, setBreakpoint] = useState<"lg" | "sm">(getRglBreakpoint);
  const breakpointRef = useRef(breakpoint);
  breakpointRef.current = breakpoint;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const bpTransitionRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [layoutSettled, setLayoutSettled] = useState(false);
  const layoutSettledRef = useRef(false);
  const [entering, setEntering] = useState(false);
  const enterFiredRef = useRef(false);
  const [gridWidth, setGridWidth] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const cols = breakpoint === "sm" ? COLS.sm : COLS.lg;
  const rowHeight = breakpoint === "sm" ? ROW_HEIGHT.sm : ROW_HEIGHT.lg;
  const gridMargin = breakpoint === "sm" ? GRID_MARGIN.sm : GRID_MARGIN.lg;

  useEffect(() => {
    return () => {
      if (bpTransitionRef.current) clearTimeout(bpTransitionRef.current);
    };
  }, []);

  useEffect(() => {
    if (editing) {
      layoutSettledRef.current = true;
      setLayoutSettled(true);
      setEntering(false);
      enterFiredRef.current = true;
      onEnterComplete?.();
      return;
    }
    if (!layoutSettled || enterFiredRef.current) return;
    setEntering(true);
    const t = window.setTimeout(() => {
      enterFiredRef.current = true;
      setEntering(false);
      onEnterComplete?.();
    }, CARD_ENTER_MS);
    return () => window.clearTimeout(t);
  }, [layoutSettled, editing, onEnterComplete]);

  const markLayoutSettled = useCallback(() => {
    if (layoutSettledRef.current) return;
    layoutSettledRef.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setLayoutSettled(true));
    });
  }, []);

  const measureGridWidth = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const w = Math.round(el.getBoundingClientRect().width);
    if (w > 0) setGridWidth(w);
  }, []);

  useLayoutEffect(() => {
    measureGridWidth();
    // Sidebar / shell width animates on desktop — remeasure after transition.
    const t = window.setTimeout(measureGridWidth, LAYOUT_TRANSITION_MS + 40);
    return () => window.clearTimeout(t);
  }, [measureGridWidth, layout.lg.length]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measureGridWidth());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureGridWidth]);

  const gridGuideStyle = useMemo((): CSSProperties | undefined => {
    if (!editing || gridWidth <= 0) return undefined;
    const colWidth = (gridWidth - gridMargin * (cols - 1)) / cols;
    return {
      "--dash-step-x": `${colWidth + gridMargin}px`,
      "--dash-step-y": `${rowHeight + gridMargin}px`,
    } as CSSProperties;
  }, [cols, editing, gridWidth, gridMargin, rowHeight]);

  const rglLayouts = useMemo<ResponsiveLayouts>(
    () => ({ lg: toRgl(layout.lg, COLS.lg), sm: toRgl(layout.sm, COLS.sm) }),
    [layout],
  );

  const smById = useMemo(() => new Map(layout.sm.map((it) => [it.id, it])), [layout.sm]);
  const itemsByBp = { lg: layout.lg, sm: layout.sm };
  const isMobile = breakpoint === "sm";
  const layoutItems = isMobile ? layout.sm : layout.lg;
  const reservedHeight = useMemo(
    () => estimateGridHeight(layoutItems, rowHeight, gridMargin),
    [layoutItems, rowHeight, gridMargin],
  );
  const wrapStyle = useMemo((): CSSProperties => {
    const base: CSSProperties =
      gridWidth > 0 ? (gridGuideStyle ?? {}) : { minHeight: reservedHeight };
    return gridGuideStyle ? { ...base, ...gridGuideStyle } : base;
  }, [gridGuideStyle, gridWidth, reservedHeight]);

  const gridReady = gridWidth > 0;
  const measuring = gridReady && !layoutSettled;
  const showEnter = entering && !editing && layoutSettled;
  const shellVisible = layoutSettled || editing;
  const showSkeleton = shellVisible && cardsEntered && statsLoading && !editing;

  // Layout positions come from saved data — settle once width is known (don't
  // wait for RGL onLayoutChange, which may not fire if the grid never mounts).
  useEffect(() => {
    if (editing || !gridReady || layoutSettledRef.current) return;
    markLayoutSettled();
    const fallback = window.setTimeout(markLayoutSettled, 150);
    return () => window.clearTimeout(fallback);
  }, [editing, gridReady, markLayoutSettled]);

  return (
    <div
      ref={wrapRef}
      className={`dashboard-grid-wrap${layoutSettled ? " dashboard-grid-wrap--ready" : ""}${showEnter ? " dashboard-grid-wrap--enter" : ""} ${editing ? "dashboard-grid-wrap--editing" : ""}`}
      style={wrapStyle}
    >
      {gridReady && (
      <Responsive
        width={gridWidth}
        className={`dashboard-grid${measuring ? " dashboard-grid--measuring" : ""}${showEnter ? " dashboard-grid--enter" : ""}`}
        layouts={rglLayouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={rowHeight}
        margin={[gridMargin, gridMargin] as const}
        containerPadding={[0, 0] as const}
        useCSSTransforms
        compactType={layoutSettled && !entering && (isMobile || !editing) ? "vertical" : null}
        preventCollision={editing && !isMobile}
        isDraggable={editing}
        isResizable={editing}
        onBreakpointChange={(bp) => {
          const next = bp === "sm" ? "sm" : "lg";
          setBreakpoint(next);
          if (bpTransitionRef.current) clearTimeout(bpTransitionRef.current);
          bpTransitionRef.current = setTimeout(() => {
            bpTransitionRef.current = null;
            const current = layoutRef.current;
            if (next === "lg" && lgLayoutNeedsRepair(current.lg)) {
              onLayoutChange(
                "lg",
                compactLayoutVertical(
                  current.lg.map((it) => normalizeLayoutItem(it, 12)),
                  12,
                ),
              );
            } else if (next === "sm" && smLayoutNeedsRepack(current.sm)) {
              onLayoutChange("sm", normalizeSmLayout(current.sm));
            }
          }, LAYOUT_TRANSITION_MS);
        }}
        onLayoutChange={(_current: Layout, allLayouts: ResponsiveLayouts) => {
          if (!layoutSettledRef.current) {
            markLayoutSettled();
            return;
          }
          if (bpTransitionRef.current) return;
          const bp = breakpointRef.current;
          const bpCols = bp === "sm" ? COLS.sm : COLS.lg;
          const rgl = allLayouts[bp];
          if (!rgl) return;

          if (bp === "sm") {
            const merged = mergeRglPositions(itemsByBp.sm, rgl, bpCols);
            const packed = normalizeSmLayout(merged);
            const prevSig = layoutSignature(layout.sm);
            const nextSig = layoutSignature(packed);
            if (prevSig !== nextSig) {
              onLayoutChange("sm", packed);
            }
            return;
          }

          if (!editing) return;
          const merged = mergeRglPositions(itemsByBp.lg, rgl, bpCols);
          onLayoutChange("lg", compactLayoutVertical(merged, 12));
        }}
      >
        {layout.lg.map((lgItem, cardIndex) => {
          const def = getCardDef(lgItem.type);
          const item: DashboardLayoutItem =
            breakpoint === "sm" ? (smById.get(lgItem.id) ?? lgItem) : lgItem;
          return (
            <div
              key={item.id}
              className={`dashboard-card card${editing ? " dashboard-card--editing" : ""}${isStatCard(item.type) ? " dashboard-card--stat" : ""}`}
              style={
                {
                  "--card-i": cardIndex,
                  "--card-y": item.y,
                } as CSSProperties
              }
            >
              {editing && (
                <div className="dashboard-card-chrome">
                  <span className="dashboard-drag-handle" title="Drag" aria-hidden>
                    ≡
                  </span>
                  <span className="dashboard-card-label">{def.label}</span>
                  <button
                    type="button"
                    className="dashboard-card-remove"
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onClick={() => onRemove(item.id)}
                    aria-label={`Remove ${def.label}`}
                  >
                    ✕
                  </button>
                </div>
              )}
              {!editing && <h3 className="dashboard-card-heading">{def.label}</h3>}
              <div
                className={`dashboard-card-content${
                  contentReady ? " dashboard-card-content--ready" : ""
                }${showSkeleton ? " dashboard-card-content--loading" : ""}${
                  shellVisible && !contentReady && !showSkeleton
                    ? " dashboard-card-content--shell"
                    : ""
                }`}
              >
                <DashboardCardBody
                  type={item.type}
                  stats={stats}
                  supervision={supervision}
                  item={item}
                  supervisees={supervisees}
                  shellVisible={shellVisible}
                  showSkeleton={showSkeleton}
                  contentReady={contentReady}
                  onSuperviseeConfig={(memberId) => onSuperviseeConfig(item.id, memberId)}
                />
              </div>
            </div>
          );
        })}
      </Responsive>
      )}
    </div>
  );
}
