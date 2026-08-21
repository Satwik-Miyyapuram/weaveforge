"use client";

import { useEffect, useRef, useState } from "react";
import { EntityCard } from "@/components/entity-card";
import { WeaveForgeLogo } from "@/components/weave-forge-logo";
import { ReactiveMotion } from "@/app/reactive-motion";
import css from "./pitch.module.css";
import { APP_URL, DOCS_URL, REPO_URL } from "./links";
import { Act, PaperStack, Scene, Spread, StatusPill } from "./chrome";
import { HeroScene } from "./hero";
import { LiveRun, WhySection } from "./story";
import { ReadingScene } from "./reader-scene";
import { CompareTable } from "./compare";
import { ThemePalette } from "./theme-palette";
import { useCursorGlow } from "./use-pitch-scroll";

/**
 * Public product pitch.
 *
 * Every object on this page is rendered by the app's own <EntityCard>, painted
 * by app/styles/ and themed by the tokens in app/themes/ — so changing a card in the product
 * changes it here, with no copy to keep in step. The graph borrows the real
 * relation and tag colours from the graph module for the same reason.
 *
 * The content is hardcoded rather than fetched: this route is public and must
 * render with no session, no project and no database. It mirrors the project's
 * own showcase seed (scripts/seed-showcase-data.mjs).
 */

export default function PitchPage() {
  const [navOn, setNavOn] = useState<string>("");
  const pageRef = useRef<HTMLDivElement>(null);
  useCursorGlow();

  /**
   * Scroll progress, and the reveal that introduces each scene.
   *
   * The reveal starts from a class this effect adds, never from the
   * stylesheet alone: a heading that is invisible until JavaScript arrives is
   * a heading that stays invisible when JavaScript does not.
   */
  useEffect(() => {
    const page = pageRef.current;
    const scroller = document.scrollingElement as HTMLElement | null;
    if (!page || !scroller) return;

    let frame = 0;
    const paint = () => {
      frame = 0;
      const travel = scroller.scrollHeight - scroller.clientHeight;
      page.style.setProperty("--pitch-progress", travel > 0 ? String(scroller.scrollTop / travel) : "0");
    };
    // Capture phase on the document, for the same reason `useScrollSteps`
    // does it: a listener bound to the container itself never fires here, and
    // capture on the document catches the scroll wherever it originates.
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(paint); };
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onScroll, { passive: true });
    paint();

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let io: IntersectionObserver | null = null;
    if (!still) {
      page.dataset.reveal = "on";
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            (e.target as HTMLElement).dataset.in = "true";
            // Once only. A heading that re-animates every time it is scrolled
            // back past is a heading that never settles.
            io?.unobserve(e.target);
          }
        },
        // Generous on purpose. A stricter trigger — wait until a fifth of the
        // heading is past a tenth of the viewport — measured well and read
        // badly: on a quick scroll the heading was still fading up as it
        // crossed the middle of the screen, so the reader met every chapter
        // half-transparent. It now starts the moment any part of it enters,
        // and is done in less time than a flick of the wheel takes.
        { rootMargin: "0px 0px 5% 0px", threshold: 0 },
      );
      for (const head of document.querySelectorAll("[data-scene-head]")) io.observe(head);
    }

    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
      io?.disconnect();
    };
  }, []);

  useEffect(() => {
    const ids = ["overview", "why", "chain", "reading", "experiments", "writing", "labs", "selfhost", "compare"];
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

  /**
   * A section link in the header.
   *
   * `low` marks the entries the bar sheds first. The full set does not fit
   * beside the brand and the actions until the window is wide enough for the
   * header's own 1320px measure, and a nav that overflows is a nav with links
   * nobody can reach — so the four least load-bearing ones (each reachable
   * from the prose, and two of them from the hero's audience chips) drop out
   * below that, rather than the last two silently falling off the end.
   */
  const navLink = (id: string, label: string, low = false) => (
    <a
      href={`#${id}`}
      className={low ? css.navLow : undefined}
      aria-current={navOn === id ? "true" : undefined}
    >
      {label}
    </a>
  );

  return (
    <div className={css.page} data-sec={navOn || "top"} ref={pageRef}>
      {/* Ground layer. Its position tracks the section the scrollspy reports,
          so the light moves with the reader rather than on a timer. */}
      <div className={css.aurora} aria-hidden />
      {/* Follows the pointer. Painted above the ground layers, below content. */}
      <div className={css.cursorGlow} aria-hidden />
      {/* The product's own pointer plumbing, which publishes --rx/--ry on the
          card under the cursor so the sheen in app/styles/motion.css has somewhere to go. */}
      <ReactiveMotion />
      <header className={css.head}>
        <div className={`${css.wrap} ${css.headIn}`}>
          <a className={css.brand} href="#top">
            <WeaveForgeLogo />
            <span className={css.brandName}>WeaveForge</span>
          </a>
          <nav className={css.nav} aria-label="Sections">
            {navLink("overview", "Overview")}
            {navLink("why", "Why", true)}
            <span className={`${css.navSep} ${css.navLow}`} aria-hidden />
            {navLink("chain", "The chain")}
            {navLink("reading", "Reading")}
            {navLink("experiments", "Experiments")}
            {navLink("writing", "Writing", true)}
            <span className={`${css.navSep} ${css.navLow}`} aria-hidden />
            {navLink("labs", "Labs", true)}
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
          {/* The ground the rest of the page is made of, stated before a
              single word about it. Two layers, because a tiled field of paper
              behind the headline reads as dirt at every size that fits: grain
              carries the texture under the words, and one small stack off to
              the side is the only thing asked to read as paper. */}
          <div className={css.heroGrain} aria-hidden />
          <PaperStack />
          <div className={`${css.wrap} ${css.above}`}>
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

        <Act id="act-you" n="Act I" name="You, and one paper" />

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

        <ReadingScene />

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

        <Spread
          id="writing"
          eyebrow="Plan & writing"
          heading="The outline is the project, not a document about it."
          lede="Sections carry status and word targets, milestones carry what blocks them, and the whole thing exports as LaTeX with the bibliography already resolved."
          points={[
            { k: "cite", body: <>Type <code>[[</code> or <code>@</code> and pick the paper. It resolves to a real citation on export, not a string you go back and fix.</> },
            { k: "export", body: <>A LaTeX project with {"\cite{}"} keys, the .bib and your figures — or a linked Overleaf document kept in sync.</> },
            { k: "logbook", body: "Dated entries with hours and mood, for when you write the methods up months after the fact." },
          ]}
          figure={
            <div>
              <p className={css.stageCap}>report · outline</p>
              <ul className={css.stack}>
                <EntityCard as="li" className="section-item" title={<><span className="muted">2.1.1 </span>VAE variants</>} meta="520 / 900 words" status={<StatusPill value="drafting" />} />
                <EntityCard as="li" className="section-item" title={<><span className="muted">2.1.2 </span>Disentanglement literature</>} meta="0 / 700 words" status={<StatusPill value="not_started" />} />
                <EntityCard as="li" className="section-item" title={<><span className="muted">3.1 </span>Encoder architecture</>} meta="0 / 2,200 words" status={<StatusPill value="not_started" />} />
                <EntityCard as="li" className="section-item" title={<><span className="muted">3.2 </span>Graph-prior module</>} meta="0 / 2,400 words · 3 runs attached" status={<StatusPill value="not_started" />} />
              </ul>
            </div>
          }
        />

        <Act id="act-group" n="Act II" name="Your group" />

        <Scene
          tone="band"
          id="labs"
          eyebrow="Labs & supervision"
          heading="Your group sees objects, not screenshots."
          lede="Collaboration is a permission on a row and a cursor in your note — not a second product bolted on the side."
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
            <div key="coedit">
              <p className={css.stageCap}>vault note · two people, one document</p>
              <EntityCard title="Disentanglement reading cluster" meta="editing with dr. m. haddad">
                <pre className="code-block">{`β-VAE trades reconstruction for disentanglement.
The ablation in §4 is the one to reproduce▏          ← you
                                     ▏dr. m. haddad`}</pre>
                <dl className={css.kv}>
                  <div><dt>merge strategy</dt><dd>CRDT · no last-writer-wins</dd></div>
                  <div><dt>save button</dt><dd>none</dd></div>
                  <div><dt>conflict dialogs</dt><dd>0</dd></div>
                </dl>
              </EntityCard>
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
            { idx: "02", title: "Share objects, not screenshots.", body: "Share a paper, an experiment, a report section, or a whole type. Your labmate pins it into their own library and comments on it — on the object, where the work is, not in a thread somewhere else." },
            { idx: "03", title: "Write the note together.", body: "Notes and log entries are live documents. Both cursors are on screen, both sets of keystrokes land, and the text merges as a CRDT — so there is no save button, no “someone else has saved this” dialog, and no version of the note that quietly won. Wikilinks, citation completion and find-in-note all still work while you do it." },
            { idx: "04", title: "Scoped by the database.", body: "Postgres row-level security is the access boundary, not application code. Owner-or-shared is enforced where the data lives, so a bug in a screen cannot leak a row." },
            { idx: "05", title: "Or nobody at all.", body: "Standalone is a first-class path: the entire product with the collaboration surface out of the way. Data is encrypted at rest but not end-to-end — the docs say so plainly." },
          ]}
        />

        <Act id="act-server" n="Act III" name="Your server" />

        <Spread
          id="selfhost"
          eyebrow="Run it yourself"
          heading="Clone it, run it, keep it."
          lede="Six commands from a fresh checkout to a running workspace on your own machine, with no capability held back for the hosted one."
          points={[
            { k: "licence", body: "AGPL-3.0-only, and it stays that way. Host a better version and you publish your source, so the work flows back rather than away." },
            { k: "parity", body: "Self-hosting is not a stripped tier. It is the same product with your name on the database — Supabase or plain Postgres, migrations in the repo." },
            { k: "core", body: "A framework-agnostic core with repository contracts and shared test suites, so the domain logic is testable without a browser, a network or a database." },
          ]}
          figure={
            <div>
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
            </div>
          }
        />

        <section className={`${css.close} ${css.band}`}>
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
