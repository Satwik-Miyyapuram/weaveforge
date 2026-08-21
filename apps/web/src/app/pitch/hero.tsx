"use client";

import css from "./pitch.module.css";
import { Step } from "./chrome";
import { useScrollSteps } from "./use-pitch-scroll";

export const ORBIT = [
  { id: "library", label: "library", note: "20 papers", tool: "Zotero", line: "Papers arrive with their metadata, annotations and tags — and stay attached to everything they touch." },
  { id: "notes", label: "notes", note: "vault", tool: "Obsidian", line: "A markdown vault with wikilinks, where an excerpt is a real object pointing back at page four of the PDF." },
  { id: "plan", label: "plan", note: "4 milestones", tool: "a task app", line: "Milestones that carry dependencies and compute estimates, and know which note they came out of." },
  { id: "experiments", label: "experiments", note: "3 runs", tool: "Weights & Biases", line: "Runs land in the same database as the paper they implement, pinned to the branch and commit that produced them." },
  { id: "report", label: "report", note: "outline", tool: "Overleaf", line: "The outline is the project. Figures and citations are already resolved, so the LaTeX export needs no fixing." },
  { id: "lab", label: "lab", note: "shared", tool: "screenshots in chat", line: "Your collaborators open the object itself — the run, the section, the paper — scoped by the database." },
];

export const C = {
  W: 584, H: 736,
  CW: 436, CH: 64,          // an object card
  FX: 40, FY: 96, FW: 504, FB: 716, // folder: left, tab top, width, bottom
  BODY: 124,                // where the folder body begins, below the tab
  SX: 74, SY: 160, SG: 88,  // first slot, and slot pitch
};

/**
 * Geometry for the hero figure.
 *
 * Two states per object: dumped loose across the desk, tilted and overlapping,
 * each still living inside somebody else's product — and filed squarely in one
 * folder. The scroll story throws each one in.
 *
 * A folder rather than a diagram. Spokes and threads describe integrations
 * between things that stay separate, which is the arrangement this page argues
 * against; one folder that everything ends up in is the claim itself.
 *
 * The scattered positions cover the same canvas the folder occupies rather
 * than sitting above it, so the figure is full at every point in the story —
 * the pile lies over the folder, and empties into it.
 */
export const TOSS = ORBIT.map((m, i) => {
  const sy = C.SY + i * C.SG;
  const ox = [96, 26, 118, 34, 104, 20][i]!;
  // Each loose card waits half a slot *below* the slot it will land in.
  // Spacing them freely put every one of them on the slot above — a scatter
  // pitch of 118 against a slot pitch of 88 means the second card parks on
  // the first card's slot, so "notes" sat on top of "library" the moment
  // library landed. Offset from its own slot, a card can only ever overlap
  // slots that are still empty.
  const oy = sy + 44;
  return {
    ...m,
    sy,
    dx: ox - C.SX,
    dy: oy - sy,
    rot: [-3.4, 2.8, -2.2, 3.5, -2.9, 2.1][i]!,
  };
});

/**
 * The page's hero: one figure the reader fills by scrolling.
 *
 * A morph, not a slideshow. There is a single SVG and every part of it reads
 * the active step — each object flies out of the product it was trapped in and
 * drops into the folder, its empty slot disappearing as it lands, and the
 * folder only comes alive once all six are in. Cross-fading six finished
 * pictures would have been far easier and would have thrown away the only
 * thing this figure is for: watching the pile become one thing.
 */
export function HeroFigure({ active }: { active: number }) {
  const { W, H, CW, CH, FX, FY, FW, FB, BODY, SX } = C;
  const inside = Math.max(0, Math.min(ORBIT.length, active));
  const whole = active >= ORBIT.length + 1;
  const R = 14;
  const tabEnd = FX + 150;

  return (
    <svg className={css.figure} viewBox={`0 0 ${W} ${H}`} role="img"
         aria-label="Six research tools — library, notes, plan, experiments, report and lab — filed into one project">
      <g className={css.folder} data-on={whole}>
        <path d={`M${FX + R} ${FY}
                  H${tabEnd} l24 ${BODY - FY}
                  H${FX + FW - R} a${R} ${R} 0 0 1 ${R} ${R}
                  V${FB - R} a${R} ${R} 0 0 1 -${R} ${R}
                  H${FX + R} a${R} ${R} 0 0 1 -${R} -${R}
                  V${FY + R} a${R} ${R} 0 0 1 ${R} -${R} Z`}
              strokeWidth={1.5} />
        <text x={FX + 18} y={FY + 20} fontSize={13} fontFamily="var(--font-serif)"
              className={css.folderLabel}>one project</text>
      </g>

      {/* Empty slots: where the missing pieces go. Each vanishes as it fills,
          so the folder visibly runs out of room to be empty. */}
      {TOSS.map((p, i) => (
        <rect key={`slot-${p.id}`} x={SX} y={p.sy} width={CW} height={CH} rx={10}
              className={css.slot} data-on={i >= inside}
              strokeWidth={1} strokeDasharray="4 6" />
      ))}

      {TOSS.map((p, i) => {
        const on = i < inside;
        return (
          <g key={p.id} className={css.card} data-on={on}
             style={{
               translate: on ? "0px 0px" : `${p.dx}px ${p.dy}px`,
               rotate: on ? "0deg" : `${p.rot}deg`,
             }}>
            <rect x={SX} y={p.sy} width={CW} height={CH} rx={10} strokeWidth={1} />
            <circle cx={SX + 24} cy={p.sy + CH / 2} r={5} className={css.cardDot} />
            <text x={SX + 44} y={p.sy + CH / 2 - 4} fontSize={17} fontFamily="var(--font-serif)"
                  className={css.cardLabel}>{p.label}</text>
            <text x={SX + 44} y={p.sy + CH / 2 + 17} fontSize={11} fontFamily="var(--font-mono)"
                  className={css.cardNote}>{on ? p.note : `in ${p.tool}`}</text>
            <text x={SX + CW - 20} y={p.sy + CH / 2 + 4} textAnchor="end" fontSize={11}
                  fontFamily="var(--font-mono)" className={css.cardIdx}>
              {on ? String(i + 1).padStart(2, "0") : "—"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export const HERO_STEPS = [
  {
    idx: "00",
    title: "Six products, and none of them talk.",
    body: "Every one of these is good at its job. The problem is not any of them — it is that the thread between them only ever existed in your head, and you are going to need it in two years.",
  },
  ...ORBIT.map((m, i) => ({
    idx: String(i + 1).padStart(2, "0"),
    title: `${m.label.charAt(0).toUpperCase()}${m.label.slice(1)} goes in.`,
    body: m.line,
  })),
  {
    idx: "07",
    title: "One project.",
    body: "One database, one graph, one export. Not six tools with integrations bolted between them — one workspace where the paper, the note, the run and the section are rows that know about each other.",
  },
];

/**
 * The opening scene. Structurally the same scrollytelling as the rest of the
 * page so the reader learns the interaction once, but pinned taller and given
 * shorter steps: eight beats at the usual height would be most of a minute of
 * scrolling before the argument has started.
 */
export function HeroScene() {
  const { sceneRef, active } = useScrollSteps(HERO_STEPS.length);
  return (
    <section className={`${css.scene} ${css.overview} ${css.seam}`} id="overview"
             ref={sceneRef as React.RefObject<HTMLElement>}>
      <div className={css.wrap}>
        <div className={css.sceneInner}>
          <div className={css.stage} data-stage>
            <HeroFigure active={active} />
          </div>
          <div className={css.steps}>
            {HERO_STEPS.map((s, i) => (
              <Step key={i} i={i} active={active} idx={s.idx} title={s.title}>{s.body}</Step>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The why, before any of the how. Each moment is a real point in a research project
 * where the work is already done and the *reason* for it has gone — and each
 * one names the thing that would have kept it.
 */
