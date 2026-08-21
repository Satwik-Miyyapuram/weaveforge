"use client";

import css from "./pitch.module.css";

export const COMPARE_COLS = ["WeaveForge", "Zotero", "Obsidian", "Notion", "W&B", "Overleaf"] as const;
export type Cover = "yes" | "part" | "no";
export const COMPARE_ROWS: { need: string; cells: Record<(typeof COMPARE_COLS)[number], Cover>; note: string }[] = [
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

export const COVER_MARK: Record<Cover, string> = { yes: "●", part: "◐", no: "○" };
export const COVER_LABEL: Record<Cover, string> = { yes: "yes", part: "partly", no: "no" };

/**
 * The table is last on purpose. A grid of dots persuades nobody who has not
 * already been shown the argument, but it does answer the question a reader
 * is left holding at the end: "I already have three of these — so what?"
 */
export function CompareTable() {
  return (
    <section className={`${css.compare} ${css.seam}`} id="compare">
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
