"use client";

import css from "./pitch.module.css";
import { useScrollSteps } from "./use-pitch-scroll";

export function Step({ i, active, idx, title, children }: {
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

export function Scene({ id, eyebrow, heading, lede, views, steps, tone = "flat" }: {
  id: string;
  eyebrow: string;
  heading: string;
  lede: string;
  views: React.ReactNode[];
  steps: { idx: string; title: string; body: React.ReactNode }[];
  /** `band` lifts the scene onto a raised ground. Alternated by the caller so
   *  seven consecutive scenes read as chapters rather than one long field. */
  tone?: "flat" | "band";
}) {
  const { sceneRef, active } = useScrollSteps(steps.length);
  const single = views.length === 1;
  const ground = tone === "band" ? css.band : css.seam;

  return (
    <section className={`${css.scene} ${ground}`} id={id} ref={sceneRef as React.RefObject<HTMLElement>}>
      <div className={css.wrap}>
        <header className={css.sceneHead} data-scene-head>
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

/**
 * A drawn first page: title block, a figure box on some of them, two columns
 * of ruled text.
 *
 * Deterministic from `seed`, and deliberately so. The obvious version of this
 * uses Math.random for the line lengths, renders one set of widths on the
 * server and a different set in the browser, and hydration tears every sheet
 * on the page. A seed makes the ragged right edge a fact about the sheet's
 * position rather than about when it was drawn.
 */
export function Sheet({ seed, lit }: { seed: number; lit: boolean }) {
  // A first page has a shape before it has words: a title that runs two lines,
  // a thin author line under it, a rule, then two columns with a figure box in
  // one of them. Drawing that shape is what makes these read as papers at a
  // glance; the earlier version drew undifferentiated bars and read as smudge.
  const fig = seed % 3 !== 2;
  const line = (k: number) => `${58 + ((seed * 7 + k * 23) % 38)}%`;
  const col = (c: number) => (
    <span key={c}>
      {Array.from({ length: 7 }, (_, k) => (
        <i key={k} style={{ width: line(k + c * 11) }} />
      ))}
    </span>
  );
  return (
    <div className={css.sheet} data-lit={lit || undefined}>
      <i className={css.sheetTitle} style={{ width: `${72 + (seed % 22)}%` }} />
      <i className={css.sheetTitle} style={{ width: `${38 + (seed % 26)}%` }} />
      <i className={css.sheetAuthors} style={{ width: `${44 + (seed % 18)}%` }} />
      <span className={css.sheetRule} />
      <span className={css.sheetCols}>
        {col(0)}
        <span>
          {fig && <i className={css.sheetFig} />}
          {Array.from({ length: fig ? 4 : 7 }, (_, k) => (
            <i key={k} style={{ width: line(k + 21) }} />
          ))}
        </span>
      </span>
    </div>
  );
}

/**
 * The paper wall — a column of first pages beside the reader.
 *
 * `lit` is the one sheet in focus: the paper the scene is currently talking
 * about. A field with no subject is wallpaper; a field with one sheet lit is a
 * shelf with your paper open on it.
 */
export function PaperWall({ count, lit = -1, className }: { count: number; lit?: number; className?: string }) {
  return (
    <div className={className} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <Sheet key={i} seed={i * 13 + 5} lit={i === lit} />
      ))}
    </div>
  );
}

/**
 * The hero's papers.
 *
 * Not a tiled field. A field of mid-sized sheets behind a headline is the one
 * thing this could not be: at the size where a sheet reads as a sheet it
 * competes with the type, and at the size where it does not, it reads as
 * smudge — which is what the tiled version did.
 *
 * So: three sheets, large enough to be unmistakably paper, stacked the way
 * they land on a desk, and placed in the margin the headline does not use.
 * The texture behind the words is grain instead, which is a surface rather
 * than an object and does not compete for the same attention.
 */
export function PaperStack() {
  return (
    <div className={css.heroStack} aria-hidden>
      <Sheet seed={31} lit={false} />
      <Sheet seed={7} lit={false} />
      <Sheet seed={18} lit />
    </div>
  );
}

/**
 * The annotation macro.
 *
 * The one picture on the page that no competitor can screenshot, because it
 * is a picture of the claim rather than of a screen: a highlight, the note
 * hanging off it, and the anchor line that leaves the frame. Blown past
 * reading size on purpose — the subject is the highlight's edge and where it
 * is attached, not the sentence, and the crop at the right edge is what tells
 * you that you are close in rather than looking at a whole page.
 */
export function AnnotationMacro() {
  return (
    <figure className={css.macro} aria-hidden>
      <div className={css.macroInner}>
        <p className={`${css.macroLine} ${css.macroDim}`}>…imposes a constraint on the latent channel capacity, so that the model in turn</p>
        <p className={css.macroLine}>
          <span className={css.macroMark}>balances latent channel capacity against reconstruction accuracy</span>, and the relative
        </p>
        <p className={`${css.macroLine} ${css.macroDim}`}>strength of that trade-off is governed by a single coefficient β, tuned per dataset…</p>
        <span className={css.macroAnchor} style={{ top: "46%", height: "22%" }} />
        <div className={css.macroNote}>
          <p>Use for 2.1.2 — this is the sentence the whole capacity argument rests on.</p>
          <p className={css.macroMeta}>direct quote · p. 4 · pinned to 2.1.2</p>
        </div>
      </div>
    </figure>
  );
}

/**
 * An act marker.
 *
 * The hero offers three doors — researchers, labs, self-hosters — and the
 * body used to ignore all three, running as one undifferentiated stretch in
 * which a lab lead reached their own content most of the way down the page,
 * behind five scenes written for somebody else. These say who the next
 * stretch is addressed to, in about a second of reading, and the ground
 * changes with them so the light means something.
 */
export function Act({ id, n, name }: { id: string; n: string; name: string }) {
  return (
    <section className={css.act} id={id}>
      <div className={css.wrap}>
        <div className={css.actIn}>
          <span className={css.actNum}>{n}</span>
          <h2 className={css.actName}>{name}</h2>
          <span className={css.actRule} aria-hidden />
        </div>
      </div>
    </section>
  );
}

/**
 * A scene without the pinning.
 *
 * A pinned scene is a promise: stay here, there are four beats, the picture
 * changes under each. It is the right device three to five times, and the
 * page had seven in a row — long enough for the reader to learn the pattern
 * and start scrolling past it. A spread is for the sections that are
 * conclusions rather than arguments: the same content, side by side, taken in
 * at a glance, and the pinned scenes on either side get their weight back.
 */
export function Spread({ id, eyebrow, heading, lede, points, figure, tone = "flat" }: {
  id: string;
  eyebrow: string;
  heading: string;
  lede: string;
  points: { k: string; body: React.ReactNode }[];
  figure: React.ReactNode;
  tone?: "flat" | "band";
}) {
  return (
    <section className={`${css.spread} ${tone === "band" ? css.band : css.seam}`} id={id}>
      <div className={css.wrap}>
        <div className={css.spreadIn} data-scene-head>
          <div className={css.spreadCopy}>
            <span className={css.eyebrow}>{eyebrow}</span>
            <h2>{heading}</h2>
            <p className="muted">{lede}</p>
            <ul className={css.spreadPoints}>
              {points.map((p) => (
                <li key={p.k}><b>{p.k}</b><span>{p.body}</span></li>
              ))}
            </ul>
          </div>
          <div className={css.spreadFig}>{figure}</div>
        </div>
      </div>
    </section>
  );
}

export function StatusPill({ value, label }: { value: string; label?: string }) {
  return <span className={`status status-${value}`}>{label ?? value.replace(/_/g, " ")}</span>;
}

/**
 * The six modules, each paired with the product it is normally exiled to.
 * The pairing is the whole argument of the opening figure: nothing here is a
 * new capability, it is the same six things with the joins put back.
 */
