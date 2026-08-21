"use client";

import { useEffect, useRef, useState } from "react";
import css from "./pitch.module.css";
import { StatusPill } from "./chrome";

export const MOMENTS = [
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

export function WhySection() {
  return (
    <section className={`${css.why} ${css.band}`} id="why">
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

export const RUN_SERIES = [
  0.94, 0.71, 0.58, 0.49, 0.43, 0.38, 0.345, 0.316, 0.292, 0.271,
  0.255, 0.241, 0.229, 0.219, 0.211, 0.204, 0.198, 0.193, 0.1893, 0.1861,
  0.1845, 0.1836, 0.1831, 0.1828, 0.1826,
];

export function LiveRun() {
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
