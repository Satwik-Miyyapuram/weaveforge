"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clusterMarks, type PlanTimeline } from "@/features/plan/application/plan-timeline";

/** A mark's width plus a little air, in px: nearer marks fold into one. */
const MARK_SPAN = 26;

/**
 * The plan in time: a track filled to today, a mark per dated milestone and
 * month ticks. Milestones due close together share one striped mark with a
 * count; pressing a mark jumps to its card.
 */
export function PlanTimelineBar({
  timeline,
  pct,
  onJump,
}: {
  timeline: PlanTimeline;
  pct: number;
  onJump: (milestoneId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clusters = useMemo(
    () => clusterMarks(timeline.marks, width ? (MARK_SPAN / width) * 100 : 3),
    [timeline.marks, width],
  );

  return (
    <div ref={ref} className="plan-timeline">
      <div
        className="plan-track"
        role="progressbar"
        aria-label="Plan progress"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${timeline.today}%` }} />
      </div>
      <span className="plan-today" style={{ left: `${timeline.today}%` }}>
        <em>Today</em>
      </span>
      {clusters.map((c) => {
        const names = c.marks.map((m) => `${m.title} (${m.status.replace("_", " ")})`);
        return (
          <button
            key={c.marks[0]!.id}
            type="button"
            className="plan-mark"
            style={{ left: `${c.at}%` }}
            title={names.join("\n")}
            aria-label={`Go to ${names.join(", ")}`}
            onClick={() => onJump(c.marks[0]!.id)}
          >
            {c.marks.map((m) => (
              <span key={m.id} className={`plan-mark--${m.status}`} data-status={m.status} />
            ))}
            {c.marks.length > 1 && <b className="plan-mark-count">{c.marks.length}</b>}
          </button>
        );
      })}
      <div className="plan-months" aria-hidden>
        {timeline.months.map((mo) => (
          <span key={`${mo.label}-${mo.at}`} style={{ left: `${mo.at}%` }}>{mo.label}</span>
        ))}
      </div>
    </div>
  );
}
