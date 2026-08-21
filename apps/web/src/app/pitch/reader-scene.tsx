"use client";

import { useEffect, useRef, useState } from "react";
import type { QuotationType, ReaderAnnotation } from "@weaveforge/core";
import { EntityCard } from "@/components/entity-card";
import { RELATION_COLORS } from "@/features/relations/domain/graph-palette";
import { READER_ANNOTATION_COLORS } from "@/features/reader/application/reader-annotation-helpers";
import { AnnotationSidebar } from "@/features/reader/ui/annotation-sidebar";
import { SelectionCreateBar } from "@/features/reader/ui/selection-create-bar";
import { AnnotationOverlay } from "@/features/reader/ui/annotation-overlay";
import css from "./pitch.module.css";
import { AnnotationMacro, PaperWall, StatusPill, Step } from "./chrome";
import { Graph } from "./graph";
import { useScrollSteps } from "./use-pitch-scroll";

export const READER_ANNOTATIONS: ReaderAnnotation[] = [
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

export const READER_QUOTATION_TYPES = new Map<string, QuotationType>([
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
export const MAX_SCALE = 3.2;

export const PAPER = {
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
export const PAPER_MARKS: {
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

export function PaperPage() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [hit, setHit] = useState<{
    anns: ReaderAnnotation[];
    scale: number;
    pageHeight: number;
    pageWidth: number;
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
          pageWidth: unit.width,
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
              pageWidth={hit.pageWidth}
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

export function ReaderPanel() {
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

/**
 * Reading: the field, then one paper, then one sentence in it.
 *
 * This was two scenes — Literature and Reading & annotations — sitting back
 * to back, one about the graph over everything you have read and the next
 * about a single highlight. Nine steps of the same subject at two different
 * magnifications, introduced twice, with two headings arguing for the same
 * thing.
 *
 * As one scene it becomes a zoom: the whole field, then the cluster, then the
 * paper, then the sentence, then where that sentence ends up. Nothing is cut
 * — every step survives — and the reader is asked to stop once instead of
 * twice. The stage follows the zoom, which is why this cannot be the generic
 * `Scene`: the first four steps hold the graph, and only the last five swap
 * a view per step.
 */
export const READING_STEPS = [
  { idx: "01", title: "Import from anywhere, once.", body: "A URL, an arXiv ID, a DOI, or your whole Zotero library. Metadata, abstract and annotations arrive together, tagged and dropped into nested reading lists." },
  { idx: "02", title: "Concepts bridge the clusters.", body: "Tags are nodes in their own right, so the graph shows how a method you borrowed from one literature reaches the one you are writing in." },
  { idx: "03", title: "Relations are typed, not vibes.", body: "cites, extends, contradicts, builds on, uses method. A contradiction you recorded once is still visible the week you write the related work." },
  { idx: "04", title: "And it tells you when the field moves.", body: "Semantic Scholar watches what you track and flags new work citing it — including work that cites you." },
  { idx: "05", title: "Read the paper where you keep it.", body: "The PDF opens in the workspace, beside the library and the graph. Your Zotero annotations are already there, and anything you highlight here is a first-class row rather than a scribble in a viewer’s private store." },
  { idx: "06", title: "Anchored so it survives the file.", body: "Every annotation stores both the rectangles and a text locus. Re-download the PDF, get a different build of it, and the highlight still lands on the sentence it was about." },
  { idx: "07", title: "Say how you will use it, while you still know.", body: "Direct quote, paraphrase, or summary — the Citavi taxonomy, chosen at reading time. At writing time that one field is the difference between citing it correctly and re-reading the paper." },
  { idx: "08", title: "Pin it to the section it belongs to.", body: "An excerpt can be placed in a report section the moment you meet it, and it syncs to a vault note as well. When you write that section, the evidence is already sitting in it, with the citation resolved." },
  { idx: "09", title: "And it goes back to Zotero.", body: "Write-back is tracked per annotation — local, synced, pending, conflict. Zotero stays the reference manager it already is for you; nothing is trapped here." },
];

/** The step at which the stage stops being the field and becomes one paper. */
export const READING_ZOOM = 4;

export function ReadingScene() {
  const { sceneRef, active } = useScrollSteps(READING_STEPS.length);
  const close = active - READING_ZOOM;
  /* The lit sheet stays in the rail's outer column, furthest from the
     steps. The faint sheets read as texture wherever they fall; a sheet
     at full strength behind a line of body copy does not. Two columns of
     four, so the odd indices are the outer ones. */
  const litSheet = 1 + 2 * (active % 4);

  const views = [
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
          <div><dt>exports as</dt><dd>{"\cite{higgins2017betavae}"}</dd></div>
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
  ];

  return (
    <section className={`${css.scene} ${css.band}`} id="reading" ref={sceneRef as React.RefObject<HTMLElement>}>
      {/* The field the scene is zooming into, kept in the margin so it does
          not disappear the moment the stage is down to one page. The lit
          sheet advances with the steps: it is the paper being talked about. */}
      <div className={css.rail} aria-hidden>
        <PaperWall count={8} lit={litSheet} className={css.railIn} />
      </div>
      <div className={`${css.wrap} ${css.above}`}>
        <header className={css.sceneHead} data-scene-head>
          <span className={css.eyebrow}>Literature &amp; reading</span>
          <h2>From the whole field down to one sentence in one paper.</h2>
          <p className="muted">
            One library, one graph, and a PDF reader in the same window — where a highlight
            carries its page locus, its use in your argument, and the section it is destined for.
          </p>
        </header>

        <AnnotationMacro />

        <div className={css.sceneInner}>
          <div className={css.stage} data-stage>
            {close < 0 ? (
              <>
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
              </>
            ) : (
              <div className={css.views}>
                {views.map((v, i) => (
                  <div className={css.view} key={i} data-on={i === close}>{v}</div>
                ))}
              </div>
            )}
          </div>

          <div className={css.steps}>
            {READING_STEPS.map((s, i) => (
              <Step key={i} i={i} active={active} idx={s.idx} title={s.title}>{s.body}</Step>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Rows: what research actually needs · who covers it. Grounded in docs/competitive-scan.md. */
