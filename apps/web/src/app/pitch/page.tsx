"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EntityCard } from "@/components/entity-card";
import { WeaveForgeLogo } from "@/components/weave-forge-logo";
import { ReactiveMotion } from "@/app/reactive-motion";
import { RELATION_COLORS, NOTE_COLOR, REPORT_COLOR, tagColor } from "@/features/relations/domain/graph-palette";
import { READER_ANNOTATION_COLORS } from "@/features/reader/application/reader-annotation-helpers";
import { AnnotationSidebar } from "@/features/reader/ui/annotation-sidebar";
import { SelectionCreateBar } from "@/features/reader/ui/selection-create-bar";
import { AnnotationOverlay } from "@/features/reader/ui/annotation-overlay";
import type { QuotationType, ReaderAnnotation } from "@weaveforge/core";
import {
  applyTheme,
  DARK_THEME_OPTIONS,
  LIGHT_THEME_OPTIONS,
  readStoredMode,
  readStoredThemeIds,
  type ThemeMode,
} from "@/lib/theme";
import { THEME_CHANGE_EVENT } from "@/lib/theme-events";
import css from "./pitch.module.css";

/**
 * Where "Open the app" points.
 *
 * Inside the product this is the app itself. The statically exported copy on
 * GitHub Pages is a different origin entirely, so it is built with this set to
 * the deployed app's URL — a marketing page that links a visitor back to
 * itself is worse than no link at all.
 */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "/";

/**
 * Documentation and source.
 *
 * `/docs/` is relative on purpose: on the exported site the docs are a sibling
 * route, and inside the product `/docs` redirects to the docs host. One link
 * that is correct in both places.
 */
const DOCS_URL = "/docs/";
const REPO_URL = "https://github.com/Satwik-Miyyapuram/weaveforge";

/**
 * Public product pitch.
 *
 * Every object on this page is rendered by the app's own <EntityCard>, painted
 * by globals.css and themed by themes.css — so changing a card in the product
 * changes it here, with no copy to keep in step. The graph borrows the real
 * relation and tag colours from the graph module for the same reason.
 *
 * The content is hardcoded rather than fetched: this route is public and must
 * render with no session, no project and no database. It mirrors the project's
 * own showcase seed (scripts/seed-showcase-data.mjs).
 */

/** Reading-status colours, as the graph screen assigns them. */
const STATUS_COLORS: Record<string, string> = {
  to_read: "#b9b2a6",
  reading: "#7c9885",
  read: "#5a7d8c",
  skimmed: "#c98a6b",
};

type Node = {
  id: string;
  label: string;
  step: number;
  kind?: "paper" | "tag" | "note" | "report";
  status?: keyof typeof STATUS_COLORS;
  hub?: boolean;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
};

const NODES: Node[] = [
  { id: "mine", label: "Your Method", step: 0, status: "reading", hub: true },
  { id: "bvae", label: "β-VAE", step: 0, status: "read" },
  { id: "vae", label: "Kingma 2014", step: 0, status: "read" },
  { id: "vgae", label: "VGAE", step: 1, status: "read" },
  { id: "gcn", label: "Kipf 2017", step: 1, status: "skimmed" },
  { id: "notes", label: "reading cluster", step: 1, kind: "note" },
  { id: "t-dis", label: "#disentanglement", step: 1, kind: "tag" },
  { id: "t-gp", label: "#graph-prior", step: 1, kind: "tag" },
  { id: "factor", label: "FactorVAE", step: 2, status: "to_read" },
  { id: "chall", label: "Locatello 2019", step: 2, status: "read" },
  { id: "sec", label: "3.2 graph-prior", step: 2, kind: "report" },
  { id: "new", label: "new citation", step: 3, status: "reading" },
];

/** [from, to, relation, revealed-at-step] — relations from the showcase seed. */
const EDGES: [string, string, keyof typeof RELATION_COLORS | "", number][] = [
  ["mine", "bvae", "extends", 0],
  ["bvae", "vae", "extends", 0],
  ["mine", "vgae", "builds_on", 1],
  ["vgae", "gcn", "uses_method", 1],
  ["notes", "bvae", "", 1],
  ["mine", "t-gp", "", 1],
  ["vgae", "t-gp", "", 1],
  ["bvae", "t-dis", "", 1],
  ["mine", "t-dis", "", 1],
  ["factor", "bvae", "extends", 2],
  ["chall", "bvae", "contradicts", 2],
  ["chall", "factor", "cites", 2],
  ["sec", "mine", "", 2],
  ["new", "mine", "cites", 3],
];

function nodeFill(n: Node): string {
  if (n.kind === "tag") return tagColor(n.label.replace(/^#/, ""));
  if (n.kind === "note") return NOTE_COLOR;
  if (n.kind === "report") return REPORT_COLOR;
  return STATUS_COLORS[n.status ?? "read"] ?? STATUS_COLORS.read!;
}

/** A node once the layout has run: position is no longer optional. */
type Placed = Omit<Node, "x" | "y" | "vx" | "vy"> & { x: number; y: number; vx: number; vy: number };

/**
 * Settle the graph once with a force pass. Running a live simulation while the
 * reader is reading is battery spent on nothing, so this happens at mount and
 * the result is drawn as static SVG that re-tints with the theme.
 */
function layoutGraph(width: number, height: number) {
  const nodes: Placed[] = NODES.map((n, i) => ({
    ...n,
    x: width / 2 + Math.cos((i / NODES.length) * Math.PI * 2) * 130,
    y: height / 2 + Math.sin((i / NODES.length) * Math.PI * 2) * 100,
    vx: 0,
    vy: 0,
  }));
  const by = new Map(nodes.map((n) => [n.id, n]));
  const links = EDGES.flatMap(([a, b, kind, step]) => {
    const from = by.get(a), to = by.get(b);
    return from && to ? [{ a: from, b: to, kind, step }] : [];
  });

  for (let t = 0; t < 500; t++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!, b = nodes[j]!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy || 0.01;
        const d = Math.sqrt(d2);
        const f = 3400 / d2;
        a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
        b.vx += (dx / d) * f; b.vy += (dy / d) * f;
      }
    }
    for (const l of links) {
      const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const f = (d - 92) * 0.015;
      l.a.vx += (dx / d) * f; l.a.vy += (dy / d) * f;
      l.b.vx -= (dx / d) * f; l.b.vy -= (dy / d) * f;
    }
    for (const n of nodes) {
      n.vx += (width / 2 - n.x) * 0.002;
      n.vy += (height / 2 - n.y) * 0.002;
      n.vx *= 0.85; n.vy *= 0.85;
      n.x = Math.max(60, Math.min(width - 60, n.x + n.vx));
      n.y = Math.max(30, Math.min(height - 34, n.y + n.vy));
    }
  }
  // Round before returning. The same simulation on the server and in the
  // browser can land on values that differ in the last float digit, and React
  // reports that as a hydration mismatch on every <line> in the graph.
  // Two decimals is far below a pixel and identical on both sides.
  for (const n of nodes) {
    n.x = Math.round(n.x * 100) / 100;
    n.y = Math.round(n.y * 100) / 100;
  }
  return { nodes, links };
}

/**
 * Drives the pinned visual from scroll position. Geometry is the source of
 * truth: whichever step's midpoint is nearest the reading line owns the stage.
 * An IntersectionObserver alone leaves the story stuck on step one whenever
 * its callbacks are throttled or delayed.
 */
function useScrollSteps(count: number) {
  const sceneRef = useRef<HTMLElement | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    let frame = 0;

    const resolve = () => {
      frame = 0;
      const steps = [...scene.querySelectorAll<HTMLElement>("[data-step]")];
      const stage = scene.querySelector<HTMLElement>("[data-stage]");
      if (!steps.length) return;

      // Detect the layout horizontally, not vertically. Comparing tops says
      // "stacked" on a wide screen too, because the sticky stage pins to the
      // top of the viewport while the first step still starts below it.
      // Whether the two share a column is the actual question — and when they
      // do, the middle of the viewport is behind the panel.
      let top = 0;
      if (stage) {
        const sr = stage.getBoundingClientRect();
        const fr = steps[0]!.getBoundingClientRect();
        const sideBySide = sr.right <= fr.left + 1 || fr.right <= sr.left + 1;
        if (!sideBySide) top = Math.max(sr.bottom, 0);
      }
      const line = top + (window.innerHeight - top) / 2;

      let best = 0, bestD = Infinity;
      steps.forEach((s, n) => {
        const r = s.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - line);
        if (d < bestD) { bestD = d; best = n; }

        // Stacked only: fade a step out before it reaches the pinned panel,
        // so nothing is ever legible through the visual. Driven from the
        // panel's live bottom edge because that varies per scene — the
        // reader's annotation panel is 200px taller than the shortest one,
        // and any single fixed distance leaves one scene or the other wrong.
        if (top > 0) {
          const fadeTo = top + 48;    // zero *before* it touches the panel
          const fadeFrom = top + 190; // starts well below it
          const t = (r.top - fadeTo) / (fadeFrom - fadeTo);
          s.style.opacity = String(Math.max(0, Math.min(1, t)));
        } else if (s.style.opacity) {
          // Side by side, nothing passes behind: hand opacity back to the CSS
          // that dims the inactive steps.
          s.style.removeProperty("opacity");
        }
      });
      setActive(best);
    };

    const onScroll = () => { if (!frame) frame = requestAnimationFrame(resolve); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    resolve();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [count]);

  return { sceneRef, active };
}

function Step({ i, active, idx, title, children }: {
  i: number; active: number; idx: string; title: string; children: React.ReactNode;
}) {
  return (
    <article className={css.step} data-step={i} data-on={i === active}>
      <span className={css.idx}>{idx}</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </article>
  );
}

function Scene({ id, eyebrow, heading, lede, views, steps }: {
  id: string;
  eyebrow: string;
  heading: string;
  lede: string;
  views: React.ReactNode[];
  steps: { idx: string; title: string; body: React.ReactNode }[];
}) {
  const { sceneRef, active } = useScrollSteps(steps.length);
  const single = views.length === 1;

  return (
    <section className={css.scene} id={id} ref={sceneRef as React.RefObject<HTMLElement>}>
      <div className={css.wrap}>
        <header className={css.sceneHead}>
          <span className={css.eyebrow}>{eyebrow}</span>
          <h2>{heading}</h2>
          <p className="muted">{lede}</p>
        </header>

        <div className={css.sceneInner}>
          <div className={css.stage} data-stage>
            {single ? views[0] : (
              <div className={css.views}>
                {views.map((v, i) => (
                  <div className={css.view} key={i} data-on={i === active}>{v}</div>
                ))}
              </div>
            )}
          </div>

          <div className={css.steps}>
            {steps.map((s, i) => (
              <Step key={i} i={i} active={active} idx={s.idx} title={s.title}>{s.body}</Step>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function StatusPill({ value, label }: { value: string; label?: string }) {
  return <span className={`status status-${value}`}>{label ?? value.replace(/_/g, " ")}</span>;
}

/**
 * The six modules, each paired with the product it is normally exiled to.
 * The pairing is the whole argument of the opening figure: nothing here is a
 * new capability, it is the same six things with the joins put back.
 */
const ORBIT = [
  { id: "library", label: "library", note: "20 papers", tool: "Zotero", line: "Papers arrive with their metadata, annotations and tags — and stay attached to everything they touch." },
  { id: "notes", label: "notes", note: "vault", tool: "Obsidian", line: "A markdown vault with wikilinks, where an excerpt is a real object pointing back at page four of the PDF." },
  { id: "plan", label: "plan", note: "4 milestones", tool: "a task app", line: "Milestones that carry dependencies and compute estimates, and know which note they came out of." },
  { id: "experiments", label: "experiments", note: "3 runs", tool: "Weights & Biases", line: "Runs land in the same database as the paper they implement, pinned to the branch and commit that produced them." },
  { id: "report", label: "report", note: "outline", tool: "Overleaf", line: "The outline is the project. Figures and citations are already resolved, so the LaTeX export needs no fixing." },
  { id: "lab", label: "lab", note: "shared", tool: "screenshots in chat", line: "Your collaborators open the object itself — the run, the section, the paper — scoped by the database." },
];

const C = {
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
const TOSS = ORBIT.map((m, i) => {
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
function HeroFigure({ active }: { active: number }) {
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

const HERO_STEPS = [
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
function HeroScene() {
  const { sceneRef, active } = useScrollSteps(HERO_STEPS.length);
  return (
    <section className={`${css.scene} ${css.overview}`} id="overview"
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
const MOMENTS = [
  {
    quote: "“Why did you rule that out?”",
    body: "You had a good reason early on. It was a margin note in a PDF, or a message to yourself, or nowhere at all. Someone asks two years later — a supervisor, a reviewer, the version of you writing the paper.",
    then: "excerpts and notes stay attached to the paper",
  },
  {
    quote: "“Which run produced that number?”",
    body: "The figure is in your draft. The number is in the caption. The code that made it has been rewritten twice and you are no longer certain which commit it was.",
    then: "runs are pinned to branch and commit",
  },
  {
    quote: "“Hasn’t someone already done this?”",
    body: "You read it near the start. You remember the shape of the argument and not the title, and it is somewhere in four hundred PDFs.",
    then: "typed relations and a searchable graph",
  },
  {
    quote: "“Send me an update.”",
    body: "So you screenshot a chart, paste a paragraph, and describe the rest from memory — every fortnight, for as long as the project runs.",
    then: "share the objects themselves",
  },
];

function WhySection() {
  return (
    <section className={css.why} id="why">
      <div className={css.wrap}>
        <span className={css.eyebrow}>Why it exists</span>
        <h2 className={css.whyHeading}>
          Research is mostly reasoning you will not remember having done.
        </h2>
        <p className={css.lede}>
          The writing is the last stretch. The thinking is everything before it
          &mdash; a term or a decade &mdash; and almost none of the tools involved
          were built to keep that part.
        </p>

        <div className={css.whyGrid}>
          {MOMENTS.map((m) => (
            <article className={css.moment} key={m.quote}>
              <p className={css.momentQuote}>{m.quote}</p>
              <p>{m.body}</p>
              <p className={css.momentThen}>{m.then}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Graph({ upto }: { upto: number }) {
  const W = 520, H = 360;
  const { nodes, links } = layoutGraph(W, H);
  return (
    <svg className={css.fig} viewBox={`0 0 ${W} ${H}`} role="img"
         aria-label="Citation graph: papers, concept tags and typed relations from the research library">
      {links.map((l, i) => (
        <line
          key={i}
          x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y}
          stroke={l.kind ? RELATION_COLORS[l.kind] : "var(--border-strong)"}
          strokeWidth={l.kind ? 1.8 : 1.2}
          opacity={l.step <= upto ? 1 : 0}
          style={{ transition: "opacity .5s ease" }}
        />
      ))}
      {nodes.map((n) => {
        const r = n.kind === "tag" ? 7 : n.hub ? 13 : 9;
        const fill = nodeFill(n);
        return (
          <g key={n.id} opacity={n.step <= upto ? 1 : 0} style={{ transition: "opacity .5s ease" }}>
            {n.kind === "tag" ? (
              <rect x={n.x - r} y={n.y - r} width={r * 2} height={r * 2} rx={2} fill={fill} />
            ) : n.kind === "note" ? (
              <polygon points={`${n.x},${n.y - r} ${n.x + r},${n.y} ${n.x},${n.y + r} ${n.x - r},${n.y}`} fill={fill} />
            ) : n.kind === "report" ? (
              <rect x={n.x - r * 0.9} y={n.y - r * 0.9} width={r * 1.8} height={r * 1.8} rx={3} fill={fill} />
            ) : (
              <circle cx={n.x} cy={n.y} r={r} fill={fill}
                      stroke={n.hub ? "var(--ink)" : "none"} strokeWidth={n.hub ? 2 : 0} />
            )}
            <text x={n.x} y={n.y + r + 13} textAnchor="middle" fill="var(--muted)"
                  fontSize={10} fontFamily="var(--font-mono)">{n.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function LiteratureScene() {
  const { sceneRef, active } = useScrollSteps(4);
  const steps = [
    { idx: "01", title: "Import from anywhere, once.", body: "A URL, an arXiv ID, a DOI, or your whole Zotero library. Metadata, abstract and annotations arrive together, tagged and dropped into nested reading lists." },
    { idx: "02", title: "Concepts bridge the clusters.", body: "Tags are nodes in their own right, so the graph shows how a method you borrowed from one literature reaches the one you are writing in." },
    { idx: "03", title: "Relations are typed, not vibes.", body: "cites, extends, contradicts, builds on, uses method. A contradiction you recorded once is still visible the week you write the related work." },
    { idx: "04", title: "And it tells you when the field moves.", body: "Semantic Scholar watches what you track and flags new work citing it — including work that cites you." },
  ];

  return (
    <section className={css.scene} id="literature" ref={sceneRef as React.RefObject<HTMLElement>}>
      <div className={css.wrap}>
        <header className={css.sceneHead}>
          <span className={css.eyebrow}>Literature</span>
          <h2>Every paper you have read, and how they hold together.</h2>
          <p className="muted">One library, one graph, and a reference manager that stays in sync instead of being replaced.</p>
        </header>
        <div className={css.sceneInner}>
          <div className={css.stage} data-stage>
            <p className={css.stageCap}>graph</p>
            <div className="graph-wrap"><Graph upto={active} /></div>
            <div className="graph-legend card">
              <div className="graph-legend-group">
                <span className="muted graph-legend-heading">Relations</span>
                {(Object.keys(RELATION_COLORS) as (keyof typeof RELATION_COLORS)[]).map((t) => (
                  <span key={t} className="legend-item">
                    <span className="legend-swatch" style={{ background: RELATION_COLORS[t] }} />
                    {t.replace("_", " ")}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className={css.steps}>
            {steps.map((s, i) => (
              <Step key={i} i={i} active={active} idx={s.idx} title={s.title}>{s.body}</Step>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * A run's loss curve, drawn point by point.
 *
 * The numbers are a fixed series, not random: the same values render on the
 * server and in the browser, and only how many of them are visible changes.
 * Randomising here would trade a live feel for a hydration mismatch on every
 * point in the path.
 */
const RUN_SERIES = [
  0.94, 0.71, 0.58, 0.49, 0.43, 0.38, 0.345, 0.316, 0.292, 0.271,
  0.255, 0.241, 0.229, 0.219, 0.211, 0.204, 0.198, 0.193, 0.1893, 0.1861,
  0.1845, 0.1836, 0.1831, 0.1828, 0.1826,
];

function LiveRun() {
  const W = 460, H = 210, pad = 26;
  const [n, setN] = useState(0);
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Only ticks while the chart is on screen. A curve redrawing behind eight
  // sections of prose is a timer nobody is watching.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(RUN_SERIES.length);
      return;
    }
    let timer = 0;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) {
        if (!timer) {
          timer = window.setInterval(() => {
            // Loop, so a reader arriving late still sees it run.
            setN((v) => (v >= RUN_SERIES.length ? 0 : v + 1));
          }, 190);
        }
      } else if (timer) {
        window.clearInterval(timer);
        timer = 0;
      }
    }, { threshold: 0.15 });
    io.observe(host);
    return () => {
      if (timer) window.clearInterval(timer);
      io.disconnect();
    };
  }, []);

  const max = RUN_SERIES[0]!, min = 0.16;
  const px = (i: number) => pad + (i / (RUN_SERIES.length - 1)) * (W - pad * 2);
  const py = (v: number) => pad + (1 - (v - min) / (max - min)) * (H - pad * 2);
  const shown = RUN_SERIES.slice(0, Math.max(n, 1));
  const path = shown.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(2)},${py(v).toFixed(2)}`).join(" ");
  const last = shown[shown.length - 1]!;
  const lastI = shown.length - 1;
  const running = n < RUN_SERIES.length;

  return (
    <div ref={hostRef}>
      <p className={css.stageCap}>experiments · live</p>
      <div className="card">
        <div className={css.liveHead}>
          <span className={css.liveTitle}>β-VAE sweep — seed 42</span>
          <StatusPill value={running ? "running" : "done"} label={running ? "running" : "finished"} />
        </div>
        <svg className={css.fig} viewBox={`0 0 ${W} ${H}`} role="img"
             aria-label={`Validation loss by epoch, currently ${last.toFixed(4)}`}>
          {[0, 0.5, 1].map((f) => (
            <line key={f} x1={pad} x2={W - pad} y1={pad + f * (H - pad * 2)} y2={pad + f * (H - pad * 2)}
                  stroke="var(--border)" strokeWidth={1} />
          ))}
          <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2}
                strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={px(lastI)} cy={py(last)} r={4} fill="var(--accent)" />
          <text x={W - pad} y={pad - 8} textAnchor="end" fill="var(--muted)"
                fontSize={11} fontFamily="var(--font-mono)">val_loss</text>
        </svg>
        <dl className={css.kv}>
          <div><dt>epoch</dt><dd>{lastI + 1} / {RUN_SERIES.length}</dd></div>
          <div><dt>val_loss</dt><dd>{last.toFixed(4)}</dd></div>
          <div><dt>logged from</dt><dd>run.log(…)</dd></div>
        </dl>
      </div>
    </div>
  );
}

/**
 * Reading is where the argument actually gets made, and it is the step every
 * other tool hands off to a PDF viewer. Grounded in the reader domain: Zotero
 * and local annotations, the Citavi-style quotation taxonomy, and pins that
 * place an annotation in a report section.
 */
/**
 * Real annotations, shown by the reader's real panel.
 *
 * <AnnotationSidebar> and <SelectionCreateBar> are the components the app
 * renders beside a PDF — imported, not imitated. Only the rows are written
 * here, and they are ordinary ReaderAnnotation values: a Zotero highlight
 * that has synced, a local one still pending, and an underline. Everything
 * about how they look, filter and lay out comes from the product.
 */
const READER_ANNOTATIONS: ReaderAnnotation[] = [
  {
    id: "ann-1",
    origin: "zotero",
    zoteroKey: "ZKEY4A2",
    type: "highlight",
    color: READER_ANNOTATION_COLORS[0],
    text: "…a single hyperparameter β that balances latent channel capacity against reconstruction accuracy.",
    comment: "Does β survive a structured prior?",
    tags: ["disentanglement", "to-verify"],
    anchor: {
      contentHash: "9f1c…",
      locus: { quote: { type: "TextQuoteSelector", exact: "a single hyperparameter" } },
    },
    sortIndex: "00004|000512|00087",
    createdAt: "2026-02-11T09:14:00.000Z",
    updatedAt: "2026-02-11T09:14:00.000Z",
    syncState: "synced",
  },
  {
    id: "ann-2",
    origin: "local",
    zoteroKey: null,
    type: "underline",
    color: READER_ANNOTATION_COLORS[3],
    text: "unsupervised disentanglement is fundamentally impossible without inductive biases",
    comment: "Locatello's objection — answer this in 2.1.2.",
    tags: ["graph-prior"],
    anchor: { locus: { quote: { type: "TextQuoteSelector", exact: "fundamentally impossible" } } },
    sortIndex: "00006|000188|00042",
    createdAt: "2026-02-12T16:02:00.000Z",
    updatedAt: "2026-02-12T16:02:00.000Z",
    syncState: "pending",
  },
  {
    id: "ann-3",
    origin: "zotero",
    zoteroKey: "ZKEY7C9",
    type: "note",
    color: READER_ANNOTATION_COLORS[4],
    text: "",
    comment: "Figure 4 is the one to reproduce first.",
    tags: [],
    anchor: {
      contentHash: "9f1c…",
      locus: { quote: { type: "TextQuoteSelector", exact: "Figure 4" } },
    },
    sortIndex: "00009|000301|00010",
    createdAt: "2026-02-13T11:40:00.000Z",
    updatedAt: "2026-02-13T11:40:00.000Z",
    syncState: "synced",
  },
];

const READER_QUOTATION_TYPES = new Map<string, QuotationType>([
  ["ZKEY4A2", "direct"],
  ["ZKEY7C9", "summary"],
]);

/**
 * A real page of a real paper, with the highlight resolved by quote.
 *
 * The PDF is "Attention Is All You Need" (Vaswani et al., 2017), fetched
 * straight from arXiv at view time — not copied into this repository, and not
 * rehosted. It renders with the same pdf.js the reader uses.
 *
 * The highlight is not drawn at fixed coordinates. The quote is searched for
 * in the page's extracted text and the boxes come back from pdf.js, which is
 * the whole claim the surrounding scene makes: an annotation anchored to words
 * survives a file that has moved underneath it. Coordinates typed in by hand
 * would have illustrated the opposite.
 */
/** Ceiling on the render scale, so a short quote cannot blow the page up. */
const MAX_SCALE = 3.2;

const PAPER = {
  url: "https://arxiv.org/pdf/1706.03762v7",
  cite: "Vaswani et al., 2017 · arXiv:1706.03762",
};

/**
 * What to mark on the page, and with which of the reader's annotation types.
 *
 * Quotes are matched case-insensitively on normalised whitespace, so a line
 * break inside a phrase does not defeat the search. Colours are the reader's
 * own palette by index, not hex codes chosen here.
 */
const PAPER_MARKS: {
  id: string;
  type: "highlight" | "underline";
  color: string;
  quotes: string[];
  comment: string;
}[] = [
  {
    id: "mark-highlight",
    type: "highlight",
    color: READER_ANNOTATION_COLORS[0]!,
    quotes: ["based solely on attention mechanisms", "dispensing with recurrence and convolutions"],
    comment: "The claim the whole paper rests on.",
  },
  {
    id: "mark-underline",
    type: "underline",
    color: READER_ANNOTATION_COLORS[3]!,
    quotes: ["The dominant sequence transduction models"],
    comment: "What it is arguing against.",
  },
];

function PaperPage() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [hit, setHit] = useState<{
    anns: ReaderAnnotation[];
    scale: number;
    pageHeight: number;
    /** How far to slide the page inside the frame, so the quote is centred. */
    offsetX: number;
    offsetY: number;
    frameH: number;
  } | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed">("idle");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;

    // 2MB of PDF is not something to fetch for a reader who never scrolls
    // this far, so nothing happens until the scene is close.
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void run();
      },
      { rootMargin: "400px" },
    );
    io.observe(host);

    async function run() {
      setState("loading");
      try {
        const pdfjs = await import("pdfjs-dist");
        const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
        pdfjs.GlobalWorkerOptions.workerSrc = `${base}/pdf.worker.min.mjs`;

        const doc = await pdfjs.getDocument({ url: PAPER.url }).promise;
        if (cancelled) return;
        const page = await doc.getPage(1);
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        // Zoom in rather than shrink the whole page to fit. A full A4 page in
        // a column this wide renders the abstract at about four pixels a line,
        // which shows that a PDF is there and nothing about what it says. The
        // page is rendered large and then slid so the quoted lines sit in the
        // frame, with the lines above and below them for context.
        // The frame, not the canvas's parent: the slide that carries the
        // canvas is absolutely positioned, so it is as wide as the page it
        // holds, and centring against it put the quote off the left edge.
        const frameW = frameRef.current?.clientWidth ?? 460;
        const unit = page.getViewport({ scale: 1 });

        // Resolve the quotes against the page's own text, and hand the result
        // to the reader as an ordinary annotation: rects in PDF user space
        // with a bottom-left origin, which is the shape Zotero stores and the
        // shape the overlay already knows how to project.
        const content = await page.getTextContent();
        const norm = (v: string) => v.replace(/\s+/g, " ").toLowerCase();
        const stamp = "2026-02-11T09:14:00.000Z";
        const anns: ReaderAnnotation[] = [];
        const rects: number[][] = [];

        for (const mark of PAPER_MARKS) {
          const mine: number[][] = [];
          for (const item of content.items) {
            const it = item as { str?: string; transform?: number[]; width?: number };
            if (!it.str || !it.transform) continue;
            const hay = norm(it.str);
            if (!mark.quotes.some((q) => hay.includes(norm(q).slice(0, 24)))) continue;
            const t = it.transform;
            const h = Math.hypot(t[2]!, t[3]!) || 12;
            const x = t[4]!;
            const y = t[5]!;
            mine.push([x, y, x + (it.width ?? 0), y + h]);
          }
          if (!mine.length) continue;
          rects.push(...mine);
          anns.push({
            id: mark.id,
            origin: "local",
            zoteroKey: null,
            type: mark.type,
            color: mark.color,
            text: mark.quotes[0]!,
            comment: mark.comment,
            tags: [],
            anchor: { zoteroPosition: { pageIndex: 0, rects: mine } },
            sortIndex: "00001|000000|00000",
            createdAt: stamp,
            updatedAt: stamp,
            syncState: "local",
          });
        }
        if (!rects.length) { setState("failed"); return; }

        // An ink stroke in the margin beside the marked lines — the reader's
        // third annotation type, drawn through the same overlay from a `paths`
        // list rather than rects.
        const inkTop = Math.max(...rects.map((r) => r[3]!));
        const inkBottom = Math.min(...rects.map((r) => r[1]!));
        const inkX = Math.min(...rects.map((r) => r[0]!)) - 16;
        const path: number[] = [];
        const steps = 9;
        for (let i = 0; i <= steps; i++) {
          const y = inkTop - ((inkTop - inkBottom) * i) / steps;
          path.push(inkX + (i % 2 === 0 ? 0 : 5), y);
        }
        anns.push({
          id: "mark-ink",
          origin: "local",
          zoteroKey: null,
          type: "ink",
          color: READER_ANNOTATION_COLORS[2]!,
          text: "",
          comment: "Margin mark.",
          tags: [],
          anchor: { zoteroPosition: { pageIndex: 0, paths: [path] } },
          sortIndex: "00001|000000|00001",
          createdAt: stamp,
          updatedAt: stamp,
          syncState: "local",
        });

        // Bounding box of the quote, in PDF user space (bottom-left origin),
        // then in the CSS pixels the page is drawn at.
        // Scale so the marked lines fill the frame. A fixed zoom made a full
        // abstract line 809px wide inside a 589px frame and cut both ends off;
        // deriving it from the region cannot. Text-item transforms do not
        // depend on the viewport, so this is all known before rendering.
        const regionLeft = Math.min(...rects.map((r) => r[0]!)) - 20;
        const regionRight = Math.max(...rects.map((r) => r[2]!));
        const scale = Math.min(Math.max(frameW / (regionRight - regionLeft + 24), 1), MAX_SCALE);
        const viewport = page.getViewport({ scale });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.scale(dpr, dpr);
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;

        const x0 = regionLeft;
        const y0 = Math.min(...rects.map((r) => r[1]!));
        const x1 = Math.max(...rects.map((r) => r[2]!));
        const y1 = Math.max(...rects.map((r) => r[3]!));
        const boxTop = (unit.height - y1) * scale;
        const boxLeft = x0 * scale;
        const boxH = (y1 - y0) * scale;
        const boxW = (x1 - x0) * scale;
        // Context: roughly three lines of the abstract above and below.
        const pad = Math.max(72, boxH * 2.2);
        const frameH = Math.max(220, Math.round(boxH + pad * 2));
        // No contentHash on either side: the rects were measured against the
        // very file on screen, so the overlay trusts them.
        setHit({
          scale,
          pageHeight: unit.height,
          frameH,
          offsetX: Math.round(Math.max(0, boxLeft + boxW / 2 - frameW / 2)),
          offsetY: Math.round(Math.max(0, boxTop - pad)),
          anns,
        });
        setState("ready");
      } catch {
        // arXiv rate-limiting, an offline reader, a blocked request: the
        // scene still has four other visuals, so this one bows out quietly.
        if (!cancelled) setState("failed");
      }
    }

    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, []);

  return (
    <div ref={hostRef}>
      <p className={css.stageCap}>reader · {PAPER.cite}</p>
      <div
        ref={frameRef}
        className={css.paper}
        data-state={state}
        style={hit ? { height: hit.frameH } : undefined}
      >
        {/* The page and its overlay move together, so the highlight stays on
            its words no matter where the frame is looking. */}
        <div
          className={css.paperSlide}
          style={hit ? { translate: `${-hit.offsetX}px ${-hit.offsetY}px` } : undefined}
        >
          <canvas ref={canvasRef} className={css.paperCanvas} />
          {hit && (
            <AnnotationOverlay
              annotations={hit.anns}
              pageNumber={1}
              scale={hit.scale}
              rotation={0}
              pageHeight={hit.pageHeight}
              selectedId={null}
              onSelect={() => {}}
            />
          )}
        </div>
        {state !== "ready" && (
          <p className={css.paperNote}>
            {state === "failed"
              ? "arXiv did not answer — the highlight below is the same annotation."
              : "Fetching the paper from arXiv…"}
          </p>
        )}
      </div>
    </div>
  );
}

function ReaderPanel() {
  return (
    <div>
      <p className={css.stageCap}>reader · higgins et al. · annotations</p>
      <SelectionCreateBar
        pending={{ pageNumber: 4, quote: "a single hyperparameter β that balances latent channel capacity" }}
        onCreate={() => {}}
        onCancel={() => {}}
      />
      <div className={css.readerPanel}>
        <AnnotationSidebar
          annotations={READER_ANNOTATIONS}
          quotationTypes={READER_QUOTATION_TYPES}
          paperTitle="β-VAE: Learning Basic Visual Concepts"
          selectedId="ann-1"
          onSelect={() => {}}
        />
      </div>
    </div>
  );
}

function AnnotationsScene() {
  return (
    <Scene
      id="annotations"
      eyebrow="Reading & annotations"
      heading="The highlight is the object, not a stripe on a page."
      lede="A PDF reader inside the workspace, where every highlight carries its page locus, its use in your argument, and the section it is destined for."
      views={[
        <PaperPage key="paper" />,
        <ReaderPanel key="reader" />,
        <div key="t">
          <p className={css.stageCap}>annotation types</p>
          <ul className={css.stack}>
            <EntityCard as="li" title="highlight · underline · note" meta="text annotations, with colour and comment" />
            <EntityCard as="li" title="image · ink · text" meta="figures, margin scrawl and typed boxes — Zotero’s full set" />
            <EntityCard as="li" nested title="direct · paraphrase · summary" meta="how you intend to use it, decided while reading" />
          </ul>
        </div>,
        <div key="p">
          <p className={css.stageCap}>report · pinned excerpts</p>
          <EntityCard
            className="section-item"
            title={<><span className="muted">2.1.2 </span>Disentanglement literature</>}
            meta="3 excerpts pinned · 0 / 700 words"
            status={<StatusPill value="not_started" />}
          >
            <div className="callout">
              <p className="summary">
                &ldquo;…balances latent channel capacity against reconstruction accuracy.&rdquo;
              </p>
            </div>
            <dl className={css.kv}>
              <div><dt>from</dt><dd>Higgins et al. · p. 4</dd></div>
              <div><dt>exports as</dt><dd>{"\\cite{higgins2017betavae}"}</dd></div>
            </dl>
          </EntityCard>
        </div>,
        <div key="s">
          <p className={css.stageCap}>zotero · write-back</p>
          <ul className={css.stack}>
            <EntityCard as="li" title="Higgins et al. · 14 annotations" meta="imported from Zotero" status={<StatusPill value="done" label="synced" />} />
            <EntityCard as="li" title="Your highlight, p. 4" meta="made here · queued for Zotero" status={<StatusPill value="running" label="pending" />} />
            <EntityCard as="li" title="Edited on both sides" meta="surfaced, never silently overwritten" status={<StatusPill value="not_started" label="conflict" />} />
          </ul>
        </div>,
      ]}
      steps={[
        { idx: "01", title: "Read the paper where you keep it.", body: "The PDF opens in the workspace, beside the library and the graph. Your Zotero annotations are already there, and anything you highlight here is a first-class row rather than a scribble in a viewer’s private store." },
        { idx: "02", title: "Anchored so it survives the file.", body: "Every annotation stores both the rectangles and a text locus. Re-download the PDF, get a different build of it, and the highlight still lands on the sentence it was about." },
        { idx: "03", title: "Say how you will use it, while you still know.", body: "Direct quote, paraphrase, or summary — the Citavi taxonomy, chosen at reading time. At writing time that one field is the difference between citing it correctly and re-reading the paper." },
        { idx: "04", title: "Pin it to the section it belongs to.", body: "An excerpt can be placed in a report section the moment you meet it, and it syncs to a vault note as well. When you write that section, the evidence is already sitting in it, with the citation resolved." },
        { idx: "05", title: "And it goes back to Zotero.", body: "Write-back is tracked per annotation — local, synced, pending, conflict. Zotero stays the reference manager it already is for you; nothing is trapped here." },
      ]}
    />
  );
}

/** Rows: what research actually needs · who covers it. Grounded in docs/competitive-scan.md. */
const COMPARE_COLS = ["WeaveForge", "Zotero", "Obsidian", "Notion", "W&B", "Overleaf"] as const;
type Cover = "yes" | "part" | "no";
const COMPARE_ROWS: { need: string; cells: Record<(typeof COMPARE_COLS)[number], Cover>; note: string }[] = [
  { need: "Reference library & metadata", note: "import by DOI, arXiv, URL or whole Zotero library", cells: { WeaveForge: "yes", Zotero: "yes", Obsidian: "part", Notion: "no", "W&B": "no", Overleaf: "part" } },
  { need: "PDF reading with durable annotations", note: "locus anchors, quotation types, Zotero write-back", cells: { WeaveForge: "yes", Zotero: "yes", Obsidian: "part", Notion: "no", "W&B": "no", Overleaf: "no" } },
  { need: "Excerpts as objects you can argue with", note: "an excerpt links to its paper, its note and its section", cells: { WeaveForge: "yes", Zotero: "part", Obsidian: "part", Notion: "no", "W&B": "no", Overleaf: "no" } },
  { need: "Markdown vault with wikilinks", note: "nested pages, backlinks, images", cells: { WeaveForge: "yes", Zotero: "no", Obsidian: "yes", Notion: "part", "W&B": "no", Overleaf: "no" } },
  { need: "Typed relations between papers", note: "cites, extends, contradicts, builds on, uses method", cells: { WeaveForge: "yes", Zotero: "no", Obsidian: "no", Notion: "no", "W&B": "no", Overleaf: "no" } },
  { need: "One graph over papers, notes, tags and sections", note: "not a graph of files — a graph of the work", cells: { WeaveForge: "yes", Zotero: "no", Obsidian: "part", Notion: "no", "W&B": "no", Overleaf: "no" } },
  { need: "Plan with dependencies and compute estimates", note: "milestones that know what blocks them", cells: { WeaveForge: "yes", Zotero: "no", Obsidian: "part", Notion: "yes", "W&B": "no", Overleaf: "no" } },
  { need: "Experiment tracking", note: "one decorator, Lightning and Keras callbacks", cells: { WeaveForge: "yes", Zotero: "no", Obsidian: "no", Notion: "no", "W&B": "yes", Overleaf: "no" } },
  { need: "Live metrics while a run is going", note: "curves stream in beside the paper the run implements", cells: { WeaveForge: "yes", Zotero: "no", Obsidian: "no", Notion: "no", "W&B": "yes", Overleaf: "no" } },
  { need: "Runs pinned to branch and commit", note: "a number in a paper traces back to code that existed", cells: { WeaveForge: "yes", Zotero: "no", Obsidian: "no", Notion: "no", "W&B": "yes", Overleaf: "no" } },
  { need: "Run → figure → section, without a screenshot", note: "the figure exports with the LaTeX", cells: { WeaveForge: "yes", Zotero: "no", Obsidian: "no", Notion: "no", "W&B": "no", Overleaf: "part" } },
  { need: "LaTeX export with the bibliography resolved", note: "outline, .bib, figures, \\cite{} keys", cells: { WeaveForge: "yes", Zotero: "part", Obsidian: "part", Notion: "no", "W&B": "no", Overleaf: "yes" } },
  { need: "Collaboration: share objects, not screenshots", note: "papers, runs and sections, scoped per person", cells: { WeaveForge: "yes", Zotero: "part", Obsidian: "no", Notion: "yes", "W&B": "part", Overleaf: "yes" } },
  { need: "Access enforced by the database", note: "Postgres row-level security, not a check in a screen", cells: { WeaveForge: "yes", Zotero: "no", Obsidian: "no", Notion: "no", "W&B": "no", Overleaf: "no" } },
  { need: "Self-hostable, all of it", note: "AGPL-3.0-only · no hosted-only capability", cells: { WeaveForge: "yes", Zotero: "part", Obsidian: "part", Notion: "no", "W&B": "part", Overleaf: "part" } },
];

const COVER_MARK: Record<Cover, string> = { yes: "●", part: "◐", no: "○" };
const COVER_LABEL: Record<Cover, string> = { yes: "yes", part: "partly", no: "no" };

/**
 * The table is last on purpose. A grid of dots persuades nobody who has not
 * already been shown the argument, but it does answer the question a reader
 * is left holding at the end: "I already have three of these — so what?"
 */
function CompareTable() {
  return (
    <section className={css.compare} id="compare">
      <div className={css.wrap}>
        <span className={css.eyebrow}>Side by side</span>
        <h2 className={css.whyHeading}>Each of these is good at one link of the chain.</h2>
        <p className={css.lede}>
          Nothing here is a bad tool — most of them are on this page because they are
          the best at what they do, and WeaveForge syncs with several rather than
          replacing them. The gap is that research is the whole chain, and the joins
          between tools are exactly where the reasoning falls out.
        </p>

        <div className={css.tableScroll}>
          <table className={css.table}>
            <thead>
              <tr>
                <th scope="col">What research needs</th>
                {COMPARE_COLS.map((c) => (
                  <th scope="col" key={c} className={c === "WeaveForge" ? css.own : undefined}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((r) => (
                <tr key={r.need}>
                  <th scope="row">
                    {r.need}
                    <span className={css.rowNote}>{r.note}</span>
                  </th>
                  {COMPARE_COLS.map((c) => {
                    const v = r.cells[c];
                    return (
                      <td key={c} className={c === "WeaveForge" ? css.own : undefined} data-cover={v}>
                        <span aria-hidden>{COVER_MARK[v]}</span>
                        <span className={css.srOnly}>{COVER_LABEL[v]}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className={css.legend}>
          <span>● covered</span><span>◐ partly, or via a plugin</span><span>○ not its job</span>
        </p>
      </div>
    </section>
  );
}

/**
 * Theme picker for the pitch.
 *
 * The palettes are the product's own — imported, not listed again here — and
 * they are applied with the product's own `applyTheme`, so what a visitor sees
 * on this page is exactly what they would get in the app. That is the point of
 * putting it in the header: the theming is a feature, and the cheapest way to
 * demonstrate it is to let someone repaint the page they are reading.
 */
function ThemePalette() {
  const [mode, setMode] = useState<ThemeMode>("dark");
  const [ids, setIds] = useState<{ light: string; dark: string }>({ light: "light", dark: "amoled" });
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Read what the boot script already put on <html> rather than assuming a
  // default, so the control opens on the theme actually being displayed.
  useEffect(() => {
    setMode(readStoredMode());
    setIds(readStoredThemeIds());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as globalThis.Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = useCallback((nextMode: ThemeMode, id: string) => {
    setMode(nextMode);
    setIds((prev) => ({ ...prev, [nextMode]: id }));
    applyTheme(nextMode, id);
    try {
      localStorage.setItem("thesis.mode", nextMode);
      localStorage.setItem(`thesis.theme.${nextMode}`, id);
    } catch {
      // Private mode, or storage disabled. The theme still applies for this
      // visit; only remembering it across visits is lost.
    }
    // Tells the reactive-motion layer to re-check whether it should be running.
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  const current = mode === "dark" ? ids.dark : ids.light;
  const options = mode === "dark" ? DARK_THEME_OPTIONS : LIGHT_THEME_OPTIONS;
  const label = options.find((o) => o.id === current)?.label ?? "Theme";

  return (
    <div className={css.palette} ref={boxRef}>
      <button
        type="button"
        className={css.paletteBtn}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={css.swatch} aria-hidden />
        <span className={css.paletteLabel}>{label}</span>
      </button>

      {open && (
        <div className={css.paletteMenu} role="menu">
          <div className={css.paletteModes}>
            {(["light", "dark"] as ThemeMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={css.modeBtn}
                aria-pressed={mode === m}
                onClick={() => choose(m, m === "dark" ? ids.dark : ids.light)}
              >
                {m === "dark" ? "Dark" : "Light"}
              </button>
            ))}
          </div>
          <div className={css.paletteList}>
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                aria-checked={o.id === current}
                className={css.paletteItem}
                onClick={() => choose(mode, o.id)}
              >
                {/* The real attribute: themes.css keys off `[data-theme=…]`
                    with a bare selector, so this span is painted in that
                    palette and the swatch shows its actual accent. */}
                <span className={css.swatch} data-theme={o.id} aria-hidden />
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Turns the product's reactive motion layer on for the length of this page,
 * and publishes the pointer position for the page-wide glow.
 *
 * The layer is opt-in inside the app, but the pitch is where it is being sold,
 * so it runs here regardless of the visitor's stored preference — and the
 * previous value is put back on unmount, so visiting /pitch inside the app
 * cannot quietly flip a setting the user turned off.
 */
function useCursorGlow() {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.motion;
    root.dataset.motion = "reactive";
    // <ReactiveMotion> is a child, and React runs child effects before the
    // parent's — so it has already decided motion was off by the time this
    // line runs. Tell it to look again, or the card sheen never attaches.
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(pointer: fine)");
    let frame = 0;
    let pending: PointerEvent | null = null;

    const flush = () => {
      frame = 0;
      const e = pending;
      pending = null;
      if (!e) return;
      root.style.setProperty("--gx", `${e.clientX.toFixed(0)}px`);
      root.style.setProperty("--gy", `${e.clientY.toFixed(0)}px`);
      root.style.setProperty("--g-on", "1");
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      pending = e;
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const onLeave = () => root.style.setProperty("--g-on", "0");

    const on = () => !reduced.matches && fine.matches;
    if (on()) {
      document.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerleave", onLeave, { passive: true });
    }

    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      root.style.removeProperty("--gx");
      root.style.removeProperty("--gy");
      root.style.removeProperty("--g-on");
      if (previous) root.dataset.motion = previous;
      else delete root.dataset.motion;
    };
  }, []);
}

export default function PitchPage() {
  const [navOn, setNavOn] = useState<string>("");
  useCursorGlow();

  useEffect(() => {
    const ids = ["overview", "why", "chain", "literature", "annotations", "experiments", "writing", "labs", "selfhost", "compare"];
    const targets = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const seen = new Set<string>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) seen.add(e.target.id); else seen.delete(e.target.id);
      }
      // Topmost visible section wins, so scrolling up and down agree.
      let best: HTMLElement | null = null;
      for (const el of targets) {
        if (seen.has(el.id) && (!best || el.offsetTop < best.offsetTop)) best = el;
      }
      setNavOn(best?.id ?? "");
    }, { rootMargin: "-70px 0px -55% 0px", threshold: 0 });
    for (const el of targets) io.observe(el);
    return () => io.disconnect();
  }, []);

  const navLink = (id: string, label: string) => (
    <a href={`#${id}`} aria-current={navOn === id ? "true" : undefined}>{label}</a>
  );

  return (
    <div className={css.page} data-sec={navOn || "top"}>
      {/* Ground layer. Its position tracks the section the scrollspy reports,
          so the light moves with the reader rather than on a timer. */}
      <div className={css.aurora} aria-hidden />
      {/* Follows the pointer. Painted above the ground layers, below content. */}
      <div className={css.cursorGlow} aria-hidden />
      {/* The product's own pointer plumbing, which publishes --rx/--ry on the
          card under the cursor so the sheen in globals.css has somewhere to go. */}
      <ReactiveMotion />
      <header className={css.head}>
        <div className={`${css.wrap} ${css.headIn}`}>
          <a className={css.brand} href="#top">
            <WeaveForgeLogo />
            <span className={css.brandName}>WeaveForge</span>
          </a>
          <nav className={css.nav} aria-label="Sections">
            {navLink("overview", "Overview")}
            {navLink("why", "Why")}
            <span className={css.navSep} aria-hidden />
            {navLink("chain", "The chain")}
            {navLink("literature", "Literature")}
            {navLink("annotations", "Reading")}
            {navLink("experiments", "Experiments")}
            {navLink("writing", "Writing")}
            <span className={css.navSep} aria-hidden />
            {navLink("labs", "Labs")}
            <span className={css.navSep} aria-hidden />
            {navLink("selfhost", "Self-host")}
            {navLink("compare", "Compare")}
          </nav>
          <div className={css.headActions}>
            {/* Not in the section nav above: that is anchors within this page,
                and these two leave it. */}
            <a className={css.headLink} href={DOCS_URL}>Docs</a>
            <a
              className={css.headLink}
              href={REPO_URL}
              aria-label="Source on GitHub"
              title="Source on GitHub"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                <path d="M12 .5a12 12 0 0 0-3.79 23.4c.6.1.82-.26.82-.58l-.01-2.04c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22l-.01 3.29c0 .32.21.69.82.57A12 12 0 0 0 12 .5Z" />
              </svg>
            </a>
            <ThemePalette />
            <a className="btn-primary" href={APP_URL}>Open the app</a>
          </div>
          <div className={css.progress} aria-hidden />
        </div>
      </header>

      <main id="top">
        <section className={css.hero}>
          <div className={css.wrap}>
            <span className={css.eyebrow}>Open source · AGPL-3.0 · self-hostable</span>
            <h1>By the time you write it, you won&rsquo;t remember why.</h1>
            <p className={css.lede}>
              Research &mdash; a nine-month thesis, a four-year PhD, a postdoc that
              outlives both &mdash; is reading, runs and decisions scattered across six
              tools that each forget the other five.
              WeaveForge is the one workspace that keeps the thread, so the paper you
              read in week three is still attached to the run it inspired and the
              section it ends up in.
            </p>
            <div className={css.btnRow}>
              <a className="btn-primary" href={APP_URL}>Open the app</a>
              <a className="btn-secondary" href="#chain">See how it connects</a>
            </div>
            <div className={css.audience}>
              <a href="#chain"><b>Researchers</b> <span>the workspace</span></a>
              <a href="#labs"><b>Labs &amp; groups</b> <span>collaboration and supervision</span></a>
              <a href="#selfhost"><b>Self-hosters</b> <span>your Postgres, your data</span></a>
            </div>
          </div>
        </section>

        <HeroScene />

        <WhySection />

        <Scene
          id="chain"
          eyebrow="How it works · the through-line"
          heading="A paper becomes a note. A note becomes a plan."
          lede="Every other research tool holds one link of that chain and loses the rest at its boundary. Here is one paper from a real project, all the way through."
          views={[
            <div key="p">
              <p className={css.stageCap}>papers</p>
              <EntityCard
                className="paper-card"
                title="β-VAE: Learning Basic Visual Concepts with a Constrained Variational Framework"
                meta="Higgins et al. · ICLR 2017"
                tags={["vae", "disentanglement", "latent-variables", "foundations"]}
                status={<StatusPill value="not_started" label="to read" />}
              />
            </div>,
            <div key="n">
              <p className={css.stageCap}>vault</p>
              <EntityCard title="Disentanglement reading cluster" meta="vault page · linked to β-VAE" tags={["to-verify", "disentanglement"]}>
                <div className="callout">
                  <p className="summary">
                    &ldquo;…a single hyperparameter <b>β</b> that balances latent channel
                    capacity against reconstruction accuracy.&rdquo;
                  </p>
                </div>
                <p className="summary">
                  Does β survive a <em>structured</em> prior? Locatello argues unsupervised
                  disentanglement is impossible without inductive bias &mdash; a graph prior
                  is exactly that bias. See <span className="wikilink">[[Variational Graph Auto-Encoders]]</span>.
                </p>
              </EntityCard>
            </div>,
            <div key="m">
              <p className={css.stageCap}>plan</p>
              <ul className={css.stack}>
                <EntityCard as="li" title="Reproduce β-VAE baseline" meta="40 GPU-hours · finished 6d ago" status={<StatusPill value="done" />} />
                <EntityCard as="li" title="Graph-prior module" meta="blocked by: β-VAE baseline · 60 GPU-hours" status={<StatusPill value="in_progress" />} />
                <EntityCard as="li" nested title="Disentanglement ablation" meta="from note · Disentanglement reading cluster" status={<StatusPill value="not_started" />} />
              </ul>
            </div>,
            <div key="e">
              <p className={css.stageCap}>experiments</p>
              <EntityCard className="exp-item" title="β-VAE sweep — seed 42" meta="main @ a1b2c3d · implements β-VAE" status={<StatusPill value="done" />}>
                <dl className={css.kv}>
                  <div><dt>val_loss</dt><dd>0.1826</dd></div>
                  <div><dt>recon_loss</dt><dd>0.0912</dd></div>
                  <div><dt>config</dt><dd>β=4 · lr=1e-3 · seed=42</dd></div>
                </dl>
              </EntityCard>
            </div>,
            <div key="s">
              <p className={css.stageCap}>report</p>
              <EntityCard
                className="section-item"
                title={<><span className="muted">3.2 </span>Graph-prior module</>}
                meta="0 / 2,400 words · 1 run · 1 figure"
                status={<StatusPill value="not_started" />}
              >
                <p className="summary">
                  We extend the capacity-constrained objective of <span className="wikilink">[[β-VAE]]</span> with
                  a graph prior over latent factors, reaching <b>val_loss 0.1826</b> at β=4.
                </p>
                <dl className={css.kv}><div><dt>exports as</dt><dd>{"\\cite{higgins2017betavae}"}</dd></div></dl>
              </EntityCard>
            </div>,
          ]}
          steps={[
            { idx: "01 · Paper", title: "You read Higgins et al., 2017.", body: "Imported from a DOI in one paste. Metadata, abstract and your Zotero annotations arrive with it, tagged and dropped into a reading list." },
            { idx: "02 · Note", title: "A highlight becomes something you can argue with.", body: "The excerpt is an object, not text stranded in a PDF. You quote it in a vault note, disagree with it, and that note stays attached to the paper." },
            { idx: "03 · Plan", title: "The disagreement becomes a milestone.", body: "Milestones carry dependencies and compute estimates, so the plan already knows this one cannot start until the baseline lands." },
            { idx: "04 · Experiment", title: "The milestone becomes a run that remembers its source.", body: "One decorator in the training script. The run lands in the same database as the paper it implements, pinned to the branch and commit that produced it." },
            { idx: "05 · Section", title: "And the run becomes section 3.2.", body: "The outline is the project. The figure and the citation are already resolved, so the LaTeX export does not need you to fix a single reference." },
          ]}
        />

        <LiteratureScene />

        <AnnotationsScene />

        <Scene
          id="experiments"
          eyebrow="Experiments"
          heading="Runs that know which paper they came from."
          lede="Tracking that lives beside the literature and the plan, instead of in a third place you reconcile later."
          views={[
            <div key="c">
              <p className={css.stageCap}>train.py</p>
              <pre className="code-block">{`from weaveforge import track_experiment

@track_experiment(
    name="β-VAE sweep — seed 42",
    paper="higgins-2017-bvae",
    config={"beta": 4, "seed": 42},
)
def train(run):
    for epoch in range(50):
        run.log(epoch=epoch, val_loss=step())`}</pre>
            </div>,
            <div key="g">
              <p className={css.stageCap}>experiments · git pin</p>
              <EntityCard className="exp-item" title="β-VAE sweep — seed 42" meta="Higher β improves disentanglement at cost of reconstruction" status={<StatusPill value="done" />}>
                <dl className={css.kv}>
                  <div><dt>branch</dt><dd>main</dd></div>
                  <div><dt>commit</dt><dd>a1b2c3d4e5f6</dd></div>
                  <div><dt>config</dt><dd>β=4 · lr=1e-3 · batch=64</dd></div>
                  <div><dt>implements</dt><dd>higgins-2017-bvae</dd></div>
                </dl>
              </EntityCard>
            </div>,
            <LiveRun key="live" />,
            <div key="cmp">
              <p className={css.stageCap}>experiments · compare</p>
              <ul className={css.stack}>
                <EntityCard as="li" className="exp-item" title="β-VAE sweep — seed 42" meta="val_loss 0.1826 · recon 0.0912" status={<StatusPill value="done" />} />
                <EntityCard as="li" className="exp-item" title="ResNet-18 baseline" meta="val_loss 0.340 · accuracy 0.912" status={<StatusPill value="done" />} />
                <EntityCard as="li" className="exp-item" title="Graph-prior ablation" meta="train_loss 0.520 · started today" status={<StatusPill value="running" />} />
              </ul>
            </div>,
            <div key="f">
              <p className={css.stageCap}>report · figures</p>
              <EntityCard className="section-item" title={<><span className="muted">fig. 4 </span>Loss by epoch</>} meta="from run β-VAE sweep — seed 42" status={<StatusPill value="done" label="attached" />}>
                <dl className={css.kv}>
                  <div><dt>exports with</dt><dd>figures/fig4.pdf</dd></div>
                  <div><dt>screenshot round trips</dt><dd>0</dd></div>
                </dl>
              </EntityCard>
            </div>,
          ]}
          steps={[
            { idx: "01", title: "One decorator, no new dashboard.", body: "@track_experiment in your training script, and the run lands in the same database as the paper it implements. There is no separate tracking service to keep in sync." },
            { idx: "02", title: "Pinned to the commit that produced it.", body: "Branch, commit hash and config travel with the run, so a number in your paper can always be traced back to code that actually existed." },
            { idx: "03", title: "Watch it while it runs.", body: "run.log() streams metrics into the workspace, so the curve moves as the job does — in the same screen as the paper the run implements, not in a dashboard on a second monitor." },
            { idx: "04", title: "Compare sweeps without exporting anything.", body: "Overlaid curves and a comparison table, beside the papers the runs came from. Lightning and Keras callbacks ship with it, and TensorBoard or W&B histories import rather than re-run." },
            { idx: "05", title: "The figure is already the paper’s figure.", body: "Attach a run to a report section and its curve exports with the LaTeX — same numbers, no screenshot round trip." },
          ]}
        />

        <Scene
          id="writing"
          eyebrow="Plan & writing"
          heading="The outline is the project, not a document about it."
          lede="Sections carry status and word targets. When it is time to submit, the whole thing exports as LaTeX with the bibliography already resolved."
          views={[
            <div key="o">
              <p className={css.stageCap}>report · outline</p>
              <ul className={css.stack}>
                <EntityCard as="li" className="section-item" title={<><span className="muted">2.1.1 </span>VAE variants</>} meta="520 / 900 words" status={<StatusPill value="drafting" />} />
                <EntityCard as="li" className="section-item" title={<><span className="muted">2.1.2 </span>Disentanglement literature</>} meta="0 / 700 words" status={<StatusPill value="not_started" />} />
                <EntityCard as="li" className="section-item" title={<><span className="muted">3.1 </span>Encoder architecture</>} meta="0 / 2,200 words" status={<StatusPill value="not_started" />} />
                <EntityCard as="li" className="section-item" title={<><span className="muted">3.2 </span>Graph-prior module</>} meta="0 / 2,400 words · 3 runs attached" status={<StatusPill value="not_started" />} />
              </ul>
            </div>,
          ]}
          steps={[
            { idx: "01", title: "Milestones that know what blocks them.", body: "Dependencies and compute estimates live on the milestone, so the plan understands that the graph-prior module cannot start until the baseline lands." },
            { idx: "02", title: "Cite while you write.", body: "Type [[ or @ and pick the paper. It resolves to a real citation on export, not a string you have to go back and fix." },
            { idx: "03", title: "Overleaf when you need it.", body: "Export the outline as a LaTeX project with \\cite{} keys, the .bib and your figures — or keep a linked Overleaf document in sync." },
            { idx: "04", title: "A logbook that is not a chore.", body: "Dated markdown entries with hours and mood. It is the thing you will be grateful for when you write the methods up months after the fact." },
          ]}
        />

        <Scene
          id="labs"
          eyebrow="Labs & supervision"
          heading="Your group sees objects, not screenshots."
          lede="Collaboration is a permission on a row, not a second product bolted on the side."
          views={[
            <div key="l">
              <p className={css.stageCap}>people · vision-group</p>
              <ul className={css.stack}>
                <EntityCard as="li" title="dr. m. haddad" meta="professor · invite code PROF-…" />
                <EntityCard as="li" title="you" meta="PhD · 20 papers · 3 experiments" status={<StatusPill value="in_progress" label="owner" />} />
                <EntityCard as="li" title="m. okonkwo" meta="Master’s · invite code MSC-…" />
              </ul>
            </div>,
            <div key="sh">
              <p className={css.stageCap}>shared · with dr. m. haddad</p>
              <ul className={css.stack}>
                <EntityCard as="li" className="section-item" title={<><span className="muted">3.2 </span>Graph-prior module</>} meta="report section · can comment" status={<StatusPill value="done" label="shared" />} />
                <EntityCard as="li" className="exp-item" title="β-VAE sweep — seed 42" meta="experiment · read only" status={<StatusPill value="done" label="shared" />} />
                <EntityCard as="li" nested title="“Good — but show the ablation before you write this up.”" meta="dr. m. haddad · 2d ago" />
              </ul>
            </div>,
            <div key="rls">
              <p className={css.stageCap}>postgres · row-level security</p>
              <pre className="code-block">{`-- the access boundary is the database,
-- not a check inside a screen
create policy paper_read on papers
  for select using (
    user_id = auth.uid()
    or exists (select 1 from shares s
       where s.object_id = papers.id
         and s.grantee = auth.uid())
  );`}</pre>
            </div>,
            <div key="solo">
              <p className={css.stageCap}>standalone</p>
              <EntityCard title="No lab" meta="Collaboration surface hidden">
                <dl className={css.kv}>
                  <div><dt>features withheld</dt><dd>0</dd></div>
                  <div><dt>external links</dt><dd>opt-in · can expire</dd></div>
                  <div><dt>end-to-end encrypted</dt><dd>no — at rest only</dd></div>
                </dl>
              </EntityCard>
            </div>,
          ]}
          steps={[
            { idx: "01", title: "A lab in three codes.", body: "A professor creates the lab and hands out three invite codes — professor, PhD, Master’s. Joining takes one paste. No IT ticket, no admin console to learn." },
            { idx: "02", title: "Share objects, not screenshots.", body: "Share a paper, an experiment, a report section, or a whole type. Your labmate pins it into their own library, comments on it, and co-edits where you granted that." },
            { idx: "03", title: "Scoped by the database.", body: "Postgres row-level security is the access boundary, not application code. Owner-or-shared is enforced where the data lives, so a bug in a screen cannot leak a row." },
            { idx: "04", title: "Or nobody at all.", body: "Standalone is a first-class path: the entire product with the collaboration surface out of the way. Data is encrypted at rest but not end-to-end — the docs say so plainly." },
          ]}
        />

        <Scene
          id="selfhost"
          eyebrow="Run it yourself"
          heading="Clone it, run it, keep it."
          lede="Six commands from a fresh checkout to a running workspace on your own machine."
          views={[
            <div key="t">
              <p className={css.stageCap}>~/weaveforge</p>
              <pre className="code-block">{`$ git clone https://github.com/Satwik-Miyyapuram/weaveforge.git
$ cd weaveforge
$ npm install
$ npm run build:core
$ npm run test:core     # 460+ domain tests, no network
$ npm run dev           # → http://localhost:3000`}</pre>
              <div className="tag-chips" style={{ marginTop: 14 }}>
                {["Next.js PWA", "Postgres + RLS", "Python SDK", "Zotero", "GitHub / GitLab", "Overleaf", "Semantic Scholar", "Mattermost"].map((t) => (
                  <span className="tag-chip" key={t}>{t}</span>
                ))}
              </div>
            </div>,
          ]}
          steps={[
            { idx: "01", title: "The copyleft is the point.", body: "AGPL-3.0-only, and it stays that way. Anyone who takes it and hosts a better version has to publish their source, so the work flows back rather than away." },
            { idx: "02", title: "One hundred percent of the software.", body: "No capability is ever hosted-only. Self-hosting is not a stripped tier — it is the same product with your name on the database." },
            { idx: "03", title: "Your Postgres, your data.", body: "Supabase or a plain self-hosted Postgres. The schema lives in the repo as migrations, and both the web app and the Python SDK talk to it." },
            { idx: "04", title: "Built to be handed over.", body: "A framework-agnostic core with repository contracts and shared test suites, so the domain logic is testable without a browser, a network or a database." },
          ]}
        />

        <section className={css.close}>
          <div className={css.wrap}>
            <h2>Start with one paper.</h2>
            <p className={css.lede}>
              Create a project, import the last thing you read, and see where it goes.
              Nothing to migrate, nothing to configure, and the export is yours whenever
              you want it.
            </p>
            <div className={css.btnRow}>
              <a className="btn-primary" href={APP_URL}>Open the app</a>
              <a className="btn-secondary" href="https://github.com/Satwik-Miyyapuram/weaveforge">Read the source</a>
            </div>
          </div>
        </section>

        <CompareTable />
      </main>

      <footer className={css.foot}>
        <div className={`${css.wrap} ${css.footIn}`}>
          <p className="muted">WeaveForge · one workspace for papers, plan, experiments and writing · AGPL-3.0-only</p>
          <div className={css.links}>
            <a href={REPO_URL}>Source</a>
            <a href={DOCS_URL}>Docs</a>
            <a href={`${REPO_URL}/issues`}>Issues</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
