"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import s from "./scrolly.module.css";
import { APP_URL, DOCS_URL, REPO_URL } from "./links";
import { SECTIONS } from "./sections";
import "./looks.css";
import { BrandMark, GitHubMark, ThemePicker, themeAttrs, useSiteTheme } from "./site-chrome";
import { useScrolly } from "./use-scrolly";

/**
 * Public product pitch, told as a scroll.
 *
 * Each act pairs a sticky stage with a column of steps: the step nearest the
 * middle of the screen lights its objects on the stage (see ./use-scrolly).
 * One paper travels from import to section 3.2, then the page shows the
 * experiment tracking, the group features and the self-host path, and ends on
 * the comparison table.
 *
 * The content is hardcoded rather than fetched: this route is public and must
 * render with no session, no project and no database. It mirrors the project's
 * own showcase seed (scripts/seed-showcase-data.mjs).
 */

/** Joins module class names written the way they read in the CSS: `k("obj card")`. */
function k(names: string, extra?: string) {
  const out = names.split(" ").map((n) => s[n] ?? n);
  if (extra) out.push(extra);
  return out.join(" ");
}

export default function PitchPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [theme, pickTheme] = useSiteTheme();
  const [active, setActive] = useState("overview");

  useScrolly(rootRef, setActive);

  return (
    <div ref={rootRef} className={`wf-looks ${s.page}`} {...themeAttrs(theme)}>
      <header className={s.top}>
        <div className={s["top-in"]}>
          <a className={s.brand} href="#overview">
            <span className={s.logo}><BrandMark /></span>WeaveForge
          </a>
          <nav className={s.acts} aria-label="Sections">
            {SECTIONS.map((sec) => (
              <a key={sec.id} href={`#${sec.id}`} aria-current={active === sec.id ? "true" : undefined}>
                {sec.label}
              </a>
            ))}
          </nav>
          <div className={s["top-end"]}>
            <a className={s["top-link"]} href={DOCS_URL}>Docs</a>
            <a className={s["icon-btn"]} href={REPO_URL} aria-label="WeaveForge on GitHub" title="GitHub">
              <GitHubMark />
            </a>
            <ThemePicker theme={theme} onPick={pickTheme} />
            <a className={k("btn btn-primary top-cta")} href={APP_URL}>Open the app</a>
          </div>
        </div>
        <div className={s.progress} data-progress />
      </header>

      <main>
        <Hero />
        <ChainAct />
        <ExperimentsAct />
        <LabsAct />
        <SelfHostAct />
        <CompareAct />
        <section id="start" className={k("wrap outro")}>
          <h2 className={s.h2}>Start with one paper.</h2>
          <p className={s.lede}>Paste a DOI. By the time it reaches section 3.2 it will still remember where it came from.</p>
          <div className={s.row} style={{ justifyContent: "center" }}>
            <a className={k("btn btn-primary btn-lg")} href={APP_URL}>Open the app</a>
            <a className={k("btn btn-secondary btn-lg")} href={REPO_URL}>Read the source</a>
          </div>
        </section>
      </main>

      <footer className={s["foot-bar"]}>
        <div className={k("wrap foot")}>
          <span className={s["foot-brand"]}><BrandMark size={18} />WeaveForge</span>
          <span>Papers, plan, experiments and writing in one workspace · AGPL-3.0-only</span>
          <nav aria-label="Project">
            <a href={REPO_URL}>Source</a>
            <a href={DOCS_URL}>Docs</a>
            <a href={`${REPO_URL}/issues`}>Issues</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/* ---------- shared pieces ---------- */

function Card({ at, className, style, children }: { at?: number; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <article className={k(`obj card${className ? ` ${className}` : ""}`)} data-at={at} style={style}>
      {children}
    </article>
  );
}

function Head({ label, chip, tone }: { label: string; chip?: string; tone?: string }) {
  return (
    <div className={s["card-head"]}>
      <span className={s.label}>{label}</span>
      {chip && <span className={k(`chip ${tone}`)}>{chip}</span>}
    </div>
  );
}

function Kv({ k: key, v, hot }: { k: string; v: string; hot?: string }) {
  return (
    <div className={s.kv} data-hot={hot}>
      <span>{key}</span>
      <b>{v}</b>
    </div>
  );
}

function ActHead({ eyebrow, title, lede }: { eyebrow: string; title: string; lede: string }) {
  return (
    <div className={s["act-head"]}>
      <span className={s.eyebrow}>{eyebrow}</span>
      <h2 className={s.h2}>{title}</h2>
      <p className={s.lede}>{lede}</p>
    </div>
  );
}

interface StepText {
  idx: string;
  title: string;
  body: string;
  how?: ReactNode;
}

/**
 * One scrollytelling block: a sticky stage drawn at `w` × `h` and scaled to fit,
 * beside the steps that drive it.
 */
function Scrolly({ name, label, w, h, inner, flip, steps, children }: {
  name: string;
  label: string;
  w: number;
  h: number;
  inner: string;
  flip?: boolean;
  steps: StepText[];
  children: ReactNode;
}) {
  return (
    <div className={k(flip ? "scrolly flip" : "scrolly")} data-scrolly={name}>
      <div className={s["stage-col"]}>
        <div className={s.stage} aria-label={label} data-stage-frame>
          <div className={s["stage-meta"]}>
            <span className={s.pips}>
              {steps.map((st) => <i key={st.idx} data-pip />)}
            </span>
            <span className={s.label} data-count>{steps.length} / {steps.length}</span>
          </div>
          <div className={k(`stage-in ${inner}`)} data-stage data-w={w} data-h={h}>
            {children}
          </div>
        </div>
      </div>
      <div className={s.steps}>
        {steps.map((st, i) => (
          <div key={st.idx} className={s.step} data-step={i + 1}>
            <div className={s["step-card"]}>
              <span className={s["step-idx"]}>{st.idx}</span>
              <h3>{st.title}</h3>
              <p>{st.body}</p>
              {st.how && <span className={s.how}>{st.how}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const Kbd = ({ children }: { children: ReactNode }) => <span className={s.kbd}>{children}</span>;

/* ---------- hero ---------- */

const DECK = [
  { label: "papers", chip: "to read", tone: "c-toread", t: "β-VAE: learning basic visual concepts", m: "Higgins et al. · ICLR 2017", rot: -2 },
  { label: "notes", chip: "drafting", tone: "c-draft", t: "Disentanglement reading cluster", m: "linked to β-VAE · to verify", rot: 1 },
  { label: "experiments", chip: "done", tone: "c-read", t: "β-VAE sweep, seed 42", m: "val_loss 0.1826 · main @ a1b2c3d", rot: -1 },
  { label: "report", chip: "not started", tone: "c-none", t: "3.2 Graph-prior module", m: "0 / 2,400 words · 3 runs attached", rot: 2 },
];

function Hero() {
  return (
    <section id="overview" className={k("wrap hero")} data-section="overview">
      <div className={s["hero-copy"]}>
        <span className={s.eyebrow}>Open source · AGPL-3.0 · self-hostable</span>
        <h1 className={s.display}>By the time you write it, you won’t remember why.</h1>
        <p className={s.lede}>
          A thesis, a PhD, a postdoc: months of reading, runs and decisions spread across six tools that each forget
          the other five. WeaveForge keeps the thread.
        </p>
        <div className={s.row}>
          <a className={k("btn btn-primary btn-lg")} href={APP_URL}>Open the app</a>
          <a className={k("btn btn-secondary btn-lg")} href="#chain">Follow one paper</a>
        </div>
        <div className={s.aud}>
          <a href="#chain"><b>Researchers</b><span>the workspace</span></a>
          <a href="#labs"><b>Labs and groups</b><span>collaboration and supervision</span></a>
          <a href="#selfhost"><b>Self-hosters</b><span>your Postgres, your data</span></a>
        </div>
        <span className={s["scroll-cue"]}><i />Scroll. One paper travels from import to section 3.2.</span>
      </div>
      <div className={s.deck} aria-hidden="true">
        {DECK.map((c, i) => (
          <div
            key={c.t}
            className={s.card}
            style={{ "--i": i, transform: `rotate(${c.rot}deg)`, zIndex: i + 1 } as CSSProperties}
          >
            <Head label={c.label} chip={c.chip} tone={c.tone} />
            <span className={s.t}>{c.t}</span>
            <span className={s.m}>{c.m}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------- act I: the chain ---------- */

const CHAIN_STEPS: StepText[] = [
  {
    idx: "01 · Paper",
    title: "You read Higgins et al., 2017.",
    body: "Paste a DOI and it arrives with metadata, abstract and the Zotero annotations you already made. It opens in the reader where you left off.",
    how: <><Kbd>Ctrl V</Kbd> anywhere · DOI, arXiv, BibTeX or a PDF</>,
  },
  {
    idx: "02 · Note",
    title: "A highlight becomes something you can argue with.",
    body: "The excerpt is its own object. Quote it in a note, disagree with it, and the note keeps a link back to page 4.",
    how: <>Highlight, then <Kbd>Q</Kbd> to quote into a note</>,
  },
  {
    idx: "03 · Plan",
    title: "The disagreement becomes a milestone.",
    body: "Milestones carry dependencies and compute estimates, so the plan knows this cannot start until the baseline lands.",
    how: "60 GPU-h, blocked by one run, due week 14",
  },
  {
    idx: "04 · Experiment",
    title: "The milestone becomes a run that remembers its source.",
    body: "One decorator in the training script. The run lands beside the paper it tests, pinned to a commit.",
    how: <span className={s.mono}>@track_experiment(implements=…)</span>,
  },
  {
    idx: "05 · Section",
    title: "And the run becomes section 3.2.",
    body: "The figure and the citation are already resolved, so the LaTeX export needs no fixing. Months later, the paragraph still points back to page 4.",
    how: "Export · .tex, .bib and figures in one folder",
  },
];

const T15: CSSProperties = { fontSize: 15 };

function ChainAct() {
  return (
    <section id="chain" className={s.act} data-section="chain">
      <div className={s.wrap}>
        <ActHead
          eyebrow="Act I · the through-line"
          title="One paper, all the way to section 3.2."
          lede="Every other tool holds one link of this chain and drops the rest at its edge. Scroll, and watch one paper from a real project turn into a paragraph that still knows where it came from."
        />
        <Scrolly name="chain" label="The chain, from paper to section" w={620} h={640} inner="chain-in" steps={CHAIN_STEPS}>
          <svg className={s.wire} width="620" height="640" viewBox="0 0 620 640" aria-hidden="true" style={{ position: "absolute", inset: 0 }}>
            <path data-at="2" d="M290 96 C 314 96, 306 130, 330 130" />
            <path data-at="3" d="M470 222 C 470 262, 330 300, 290 300" />
            <path data-at="4" d="M290 350 C 314 350, 306 390, 330 390" />
            <path data-at="5" d="M470 460 L 470 486" />
            <path className={s.back} data-at="5" d="M60 560 C 4 560, 4 200, 40 158" />
          </svg>
          <div className={s.flag} data-at="5" style={{ left: 6, top: 500, transform: "rotate(-90deg)", transformOrigin: "left top" }}>
            still points to p. 4
          </div>

          <Card at={1} style={{ left: 10, top: 10, width: 280 }}>
            <Head label="papers" chip="reading" tone="c-reading" />
            <span className={s.t} style={T15}>β-VAE: learning basic visual concepts</span>
            <span className={s.m}>Higgins et al. · ICLR 2017 · p. 4</span>
            <span style={{ fontSize: 13, lineHeight: 1.35 }}>
              “<mark className={s.ex} data-at="2">β &gt; 1 pushes the latents to factorise</mark>, at a cost to reconstruction.”
            </span>
          </Card>

          <Card at={2} style={{ left: 330, top: 50, width: 280 }}>
            <Head label="notes" chip="drafting" tone="c-draft" />
            <span className={s.t} style={T15}>Disentanglement reading cluster</span>
            <p className={s.quote}>β &gt; 1 pushes the latents to factorise</p>
            <span style={{ fontSize: 13 }}>I doubt this holds past 3 seeds.</span>
            <span className={s["back-link"]}>↳ Higgins 2017, p. 4</span>
          </Card>

          <Card at={3} style={{ left: 10, top: 250, width: 280 }}>
            <Head label="plan · milestone" chip="in progress" tone="c-reading" />
            <span className={s.t} style={T15}>Graph-prior module</span>
            <Kv k="compute" v="60 GPU-h" />
            <Kv k="after" v="ResNet-18 baseline ✓" />
          </Card>

          <Card at={4} style={{ left: 330, top: 310, width: 280 }}>
            <Head label="experiments" chip="done" tone="c-read" />
            <span className={s.t} style={T15}>β-VAE sweep, seed 42</span>
            <svg className={s.curve} data-at="4" width="244" height="44" viewBox="0 0 244 44" aria-label="Validation loss falling to 0.1826">
              <path d="M2 6 C 40 26, 80 34, 130 38 S 210 41, 242 41" stroke="var(--reading)" />
              <path d="M2 10 C 50 24, 100 28, 150 31 S 220 33, 242 33" stroke="var(--danger)" strokeDasharray="5 5" />
            </svg>
            <span className={s.mono} style={{ fontSize: 12 }}>val_loss 0.1826 · main @ a1b2c3d</span>
          </Card>

          <Card at={5} style={{ left: 60, top: 486, width: 500, flexDirection: "row", gap: 14, alignItems: "stretch" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
              <Head label="report · section 3.2" chip="drafting" tone="c-draft" />
              <span className={s.t} style={T15}>3.2 Graph-prior module</span>
              <span style={{ fontSize: 13, lineHeight: 1.45 }}>
                Following Higgins et al. <span className={s.cite}>[12]</span>, we set β = 4 and hold it across three seeds (Fig. 3).
              </span>
            </div>
            <div className={s.fig}>
              <svg width="96" height="50" viewBox="0 0 96 50" aria-label="Figure 3, the loss curve from run a1b2c3d">
                <path d="M2 6 C 20 24, 40 34, 60 40 S 86 44, 94 44" stroke="var(--reading)" strokeWidth="3" fill="none" />
                <text x="2" y="48" fontSize="8" fontFamily="JetBrains Mono, monospace" fill="currentColor">Fig. 3</text>
              </svg>
            </div>
          </Card>
        </Scrolly>
      </div>
    </section>
  );
}

/* ---------- experiments ---------- */

const EXP_STEPS: StepText[] = [
  { idx: "1 · Script", title: "Add one decorator.", body: "Name the paper the run implements. That link is the whole setup. Lightning and Keras callbacks work the same way." },
  { idx: "2 · Train", title: "Log as it trains.", body: "Metrics stream into the workspace while the job runs, on your laptop or on the cluster." },
  { idx: "3 · Pin", title: "The run pins itself.", body: "Branch, commit and config are captured without you asking, so you can rerun it in a year." },
  { idx: "4 · Compare", title: "Compare it beside the paper.", body: "Curves sit next to the claim they test, and any one of them can become a figure in your report." },
];

function Ln({ n, hot, children }: { n: number; hot?: string; children?: ReactNode }) {
  return (
    <span className={s.ln} data-hot={hot}>
      <span className={s.n}>{n}</span>
      {children ?? " "}
    </span>
  );
}

function ExperimentsAct() {
  const kw = s.kw;
  return (
    <section id="experiments" className={s.act} data-section="experiments">
      <div className={s.wrap}>
        <ActHead
          eyebrow="Experiments"
          title="Runs that know which paper they came from."
          lede="Tracking that lives beside the reading and the plan, so there is no third place to reconcile later."
        />
        <Scrolly name="exp" label="A training script and the run it records" w={620} h={560} inner="exp-in" flip steps={EXP_STEPS}>
          <div className={k("obj code on")} style={{ position: "absolute" }}>
            <div className={k("cap label")}>train.py</div>
            <Ln n={1} hot="1"><span className={kw}>from</span> weaveforge <span className={kw}>import</span> track_experiment</Ln>
            <Ln n={2} />
            <Ln n={3} hot="1 4"><span className={kw}>@track_experiment</span>(implements=<span className={s.st}>&quot;higgins-2017-bvae&quot;</span>)</Ln>
            <Ln n={4}><span className={kw}>def</span> train(cfg, run):</Ln>
            <Ln n={5}>{"    model = BetaVAE(beta=cfg.beta)"}</Ln>
            <Ln n={6}>{"    "}<span className={kw}>for</span> epoch <span className={kw}>in</span> range(cfg.epochs):</Ln>
            <Ln n={7}>{"        loss = step(model, batch)"}</Ln>
            <Ln n={8} hot="2">{"        run.log(val_loss=loss, epoch=epoch)"}</Ln>
            <Ln n={9} hot="3"><span className={s.cm}># branch, commit and config travel with the run</span></Ln>
          </div>
          <Card at={2} style={{ left: 0, top: 318, width: 300, height: 236 }}>
            <div className={s["card-head"]}>
              <span className={s.label}>experiments · live</span>
              <span className={k("chip c-reading")} data-runchip>running</span>
            </div>
            <span className={s.t}>β-VAE sweep, seed 42</span>
            <span className={s.metric} data-metric>0.1826</span>
            <span className={s.label} style={{ marginTop: -4 }}>val_loss · epoch <span data-epoch>50</span> / 50</span>
            <Kv k="branch" v="main" hot="3" />
            <Kv k="commit" v="a1b2c3d4e5f6" hot="3" />
            <Kv k="config" v="β=4 · lr=1e-3" hot="3 4" />
          </Card>
          <Card at={4} style={{ left: 320, top: 318, width: 300, height: 236 }}>
            <Head label="compare · beside the paper" />
            <svg
              className={s.curve}
              data-at="4"
              width="264"
              height="92"
              viewBox="0 0 264 92"
              aria-label="Three loss curves"
              style={{ border: "var(--bw) solid var(--line)", borderRadius: "var(--rs)", background: "var(--well)" }}
            >
              <path d="M0 14 C 50 50, 100 72, 170 80 S 240 86, 264 88" stroke="var(--reading)" />
              <path d="M0 22 C 60 46, 120 58, 190 64 S 250 68, 264 70" stroke="var(--primary)" />
              <path d="M0 18 C 50 40, 90 50, 140 55" stroke="var(--danger)" strokeDasharray="6 5" />
            </svg>
            <Kv k="β-VAE sweep, seed 42" v="0.1826" />
            <Kv k="ResNet-18 baseline" v="0.340" />
            <Kv k="Graph-prior ablation" v="running" />
          </Card>
        </Scrolly>
      </div>
    </section>
  );
}

/* ---------- act II: labs ---------- */

const LABS_STEPS: StepText[] = [
  { idx: "01 · Share", title: "Share objects, not screenshots.", body: "Share a note, a paper, a run or one report section. Your labmate opens the object itself, with the access you gave: here, edit on the note and read only on the run." },
  { idx: "02 · Write", title: "Write the note together.", body: "Both cursors on screen, both sets of keystrokes land. The text merges as a CRDT, so there is no save button and no conflict dialog." },
  { idx: "03 · Scope", title: "Scoped by the database.", body: "Postgres row-level security is the access boundary. A bug in a screen cannot leak a row." },
  { idx: "04 · Alone", title: "Or nobody at all.", body: "Standalone is first class: the whole product, with the collaboration surface out of the way." },
];

function LabsAct() {
  return (
    <section id="labs" className={s.act} data-section="labs">
      <div className={s.wrap}>
        <ActHead
          eyebrow="Act II · your group"
          title="Your group sees objects, not screenshots."
          lede="Collaboration is a permission on a row and a cursor in your note. It is part of the same product, not a second one."
        />
        <Scrolly name="labs" label="A shared note with two people writing" w={620} h={540} inner="labs-in" steps={LABS_STEPS}>
          <article className={k("obj card note on")}>
            <div className={s["note-bar"]}>
              <span className={s.label} style={{ flex: 1 }}>notes / disentanglement</span>
              <span className={s.collab} style={{ display: "flex" }}>
                <span className={s.ava} style={{ background: "var(--hl0)" }}>SM</span>
                <span className={s.ava} style={{ background: "var(--hl2)", marginLeft: -8 }}>PB</span>
              </span>
              <span
                className={k("btn btn-secondary collab")}
                style={{ minHeight: 34, padding: "0 12px", fontSize: "calc(var(--btn-fs) - 2px)" }}
              >
                Share
              </span>
            </div>
            <div className={s["note-body"]}>
              <h4>Disentanglement reading cluster</h4>
              <p className={s.quote}>β &gt; 1 pushes the latents to factorise</p>
              <p style={{ margin: 0 }}>
                I doubt this holds past 3 seeds.
                <span className={k("caret collab")} data-who="You" style={{ background: "var(--hl0)" }} /> The sweep in 3.2
                tests it directly: β = 4, seeds 42, 7 and 1337.
              </p>
              <p style={{ margin: 0 }}>
                Person B: <span className={s.typed} data-at="2">and it fails on dSprites past 3 seeds.</span>
                <span className={k("caret collab")} data-who="Person B" style={{ background: "var(--hl2)" }} />
              </p>
              <p style={{ margin: 0, color: "var(--muted)" }}>↳ linked: Higgins 2017 · β-VAE sweep, seed 42 · section 3.2</p>
            </div>
          </article>
          <Card at={1} className="pop collab" style={{ right: 14, left: "auto", top: 0 }}>
            <span className={s.label}>share · disentanglement note</span>
            <Kv k="Person B" v="can edit" />
            <Kv k="β-VAE sweep" v="read only" />
          </Card>
          <Card at={3} className="sql collab" style={{ left: 30, top: 330 }}>
            <span className={s.label}>postgres · row-level security</span>
            <pre>{`create policy owner_or_shared on notes
  using (owner = auth.uid()
      or shared_with(id, auth.uid()));`}</pre>
          </Card>
          <span className={k("obj chip c-read solo-chip")} data-at="4" style={{ left: 18, top: 6, fontSize: 13 }}>
            Standalone · 0 features withheld
          </span>
        </Scrolly>
      </div>
    </section>
  );
}

/* ---------- act III: self-host ---------- */

const COMMANDS: [string, string][] = [
  [`git clone ${REPO_URL}`, "the whole thing"],
  ["cd weaveforge && npm install", ""],
  ["cp .env.example .env", "your Postgres URL"],
  ["npm run db:migrate", "row-level security included"],
  ["npm run build", ""],
  ["npm start", "open localhost:3000"],
];

function SelfHostAct() {
  return (
    <section id="selfhost" className={s.act} data-section="selfhost">
      <div className={s.wrap}>
        <ActHead
          eyebrow="Act III · run it yourself"
          title="Clone it, run it, keep it."
          lede="Six commands from a fresh checkout to a running workspace on your own machine. The hosted version holds nothing back."
        />
        <div className={s.term} data-term>
          <div className={s["term-bar"]}><i /><i /><i /><span style={{ marginLeft: 8 }}>~/weaveforge</span></div>
          <div className={s["term-body"]}>
            {COMMANDS.map(([cmd, note]) => (
              <div key={cmd} className={s.cmd} data-cmd>
                <span className={s.d}>$</span>
                <span className={s.t}>{cmd}</span>
                <span className={s.c}>{note}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- compare ---------- */

const TOOLS = ["WeaveForge", "Zotero", "Obsidian", "Notion", "W&B", "Overleaf"];

/** One row per need; the marks are y (yes), p (partly) or n (no), one per tool above. */
const ROWS: [string, string, string][] = [
  ["Reference library and metadata", "DOI, arXiv, URL or a whole Zotero library", "yyppnp"],
  ["PDF reading with durable annotations", "highlights and comments that survive re-imports", "yyppnn"],
  ["Excerpts as objects you can argue with", "links to its paper, note and section", "yppnnn"],
  ["Markdown notes with wikilinks", "nested pages, backlinks, images", "ynypnn"],
  ["Typed relations between papers", "cites, extends, contradicts, builds on", "ynnnnn"],
  ["One graph over papers, notes, tags and sections", "a graph of the work, not of files", "ynnpnn"],
  ["Plan with dependencies and compute", "milestones that know what blocks them", "ynpynn"],
  ["Experiment tracking", "one decorator, Lightning and Keras callbacks", "ynnnyn"],
  ["Live metrics while a run is going", "curves stream in beside the paper", "ynnnyn"],
  ["Runs pinned to branch and commit", "a number traces back to code that existed", "ynnnyn"],
  ["Run to figure to section, no screenshot", "the figure exports with the LaTeX", "ynnnnp"],
  ["LaTeX export with the bibliography resolved", "outline, .bib, figures, cite keys", "yppnny"],
  ["Share objects, not screenshots", "papers, runs and sections, scoped per person", "ypnypy"],
  ["Access enforced by the database", "Postgres row-level security", "ynnnnn"],
  ["Self-hostable, all of it", "AGPL-3.0-only, nothing hosted-only", "yppnpp"],
];

const MARK: Record<string, [string, string]> = { y: ["✓", "yes"], p: ["~", "partly"], n: ["–", "no"] };

function CompareAct() {
  return (
    <section id="compare" className={s.act} data-section="compare" style={{ paddingBottom: 64 }}>
      <div className={s.wrap}>
        <ActHead
          eyebrow="Compare"
          title="“I already have three of these. So what?”"
          lede="Each of them is good at its link. None of them passes the paper to the next one."
        />
        <div className={s["tbl-wrap"]}>
          <table>
            <thead>
              <tr>
                <th scope="col">What you need</th>
                {TOOLS.map((t, i) => (
                  <th key={t} scope="col" className={i === 0 ? s.us : undefined}>{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([need, detail, marks]) => (
                <tr key={need}>
                  <td><b>{need}</b><span>{detail}</span></td>
                  {marks.split("").map((m, i) => {
                    const [glyph, word] = MARK[m]!;
                    return (
                      <td key={TOOLS[i]} className={i === 0 ? s.us : undefined}>
                        <span className={k(`g ${m}`)} title={word} aria-label={word}>{glyph}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={s.legend}>
          <span><span className={k("g y")}>✓</span> covered</span>
          <span><span className={k("g p")}>~</span> partly, or via a plugin</span>
          <span><span className={k("g n")}>–</span> not its job</span>
        </p>
      </div>
    </section>
  );
}
