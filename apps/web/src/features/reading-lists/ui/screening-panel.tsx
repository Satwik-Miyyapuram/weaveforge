"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Paper,
  PrismaCounts,
  ReadingListItem,
  ReadingListTreeNode,
  ScreenSummary,
  ScreeningStage,
  ScreeningState,
} from "@weaveforge/core";
import {
  SCREENING_STAGES,
  agreementBetween,
  prismaCaveat,
  prismaFigureTex,
  verdictFor,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { formatError } from "@/lib/format-error";
import { latestGate } from "@/lib/latest-gate";
import { collectListIds } from "./list-ui";
import { Button } from "@/components/button";
import { ToggleButton } from "@/components/controls";

const STAGE_LABEL: Record<ScreeningStage, string> = {
  title_abstract: "Title & abstract",
  full_text: "Full text",
};

const STATE_LABEL: Record<ScreeningState, string> = {
  included: "Include",
  excluded: "Exclude",
  unsure: "Unsure",
};

const COUNT_ROWS: readonly { key: keyof PrismaCounts; label: string }[] = [
  { key: "identified", label: "Records identified" },
  { key: "duplicates", label: "Duplicates removed" },
  { key: "screened", label: "Records screened" },
  { key: "excludedAtScreening", label: "Excluded on title & abstract" },
  { key: "eligible", label: "Full texts assessed" },
  { key: "excludedAtFullText", label: "Excluded on full text" },
  { key: "included", label: "Studies included" },
];

/**
 * Screening a reading list the way a systematic review asks for it.
 *
 * Two reviewers answer the same items independently, so this shows every
 * reviewer's answer rather than a single verdict per row: a screen where you
 * cannot see that somebody disagreed with you is not a screen. The PRISMA
 * numbers underneath are derived from those answers on every render — nothing
 * here stores a count, so the panel cannot show a total the decisions do not
 * support.
 */
export function ScreeningPanel({
  node,
  papers,
  readOnly = false,
}: {
  node: ReadingListTreeNode;
  papers: Paper[];
  readOnly?: boolean;
}) {
  const [stage, setStage] = useState<ScreeningStage>("title_abstract");
  const [items, setItems] = useState<ReadingListItem[]>([]);
  const [summary, setSummary] = useState<ScreenSummary | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const titleById = useMemo(
    () => new Map(papers.map((paper) => [paper.id, paper.title])),
    [papers],
  );

  // A reload runs on mount and after each decision: keep only the newest answer.
  const [beginReload] = useState(latestGate);

  const reload = useCallback(async () => {
    const isCurrent = beginReload();
    const container = getContainer();
    const rows = await container.readingLists.listItemsForLists(collectListIds([node]));
    const screened = rows.filter((row) => !row.inheritedFromListId);
    const nextSummary = await container.readingLists.screenItems.summarize(screened);
    if (!isCurrent()) return;
    setItems(screened);
    setSummary(nextSummary);
  }, [node, beginReload]);

  useEffect(() => {
    reload().catch((e) => setError(formatError(e)));
  }, [reload]);

  // Who is screening does not change between decisions: ask once.
  useEffect(() => {
    let cancelled = false;
    getContainer()
      .auth.auth.getUser()
      .then((user) => {
        if (!cancelled) setMe(user?.id ?? null);
      })
      .catch((e) => {
        if (!cancelled) setError(formatError(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const decide = async (itemId: string, state: ScreeningState) => {
    if (!me) {
      setError("Sign in to record a screening decision.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await getContainer().readingLists.screenItems.record({
        itemId,
        reviewerId: me,
        stage,
        state,
        reason: reason[itemId],
      });
      await reload();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  const copyFigure = async () => {
    if (!summary) return;
    const tex = prismaFigureTex(summary.counts, {
      label: "fig:prisma",
      caption: `Screening of ${node.list.name}.`,
      reasons: summary.reasons,
    });
    try {
      await navigator.clipboard.writeText(tex);
      setMsg("PRISMA figure copied — paste it into a report section.");
    } catch (e) {
      setError(formatError(e));
    }
  };

  const decisionsFor = (itemId: string) =>
    (summary?.decisions ?? []).filter((d) => d.itemId === itemId && d.stage === stage);

  const caveat = summary ? prismaCaveat(summary.counts) : null;

  // Computed here rather than asked for: the decisions are already loaded, and
  // a second read of the same rows to answer a question about them would be a
  // round trip spent on arithmetic.
  const agreement = useMemo(() => {
    const pair = (summary?.reviewers ?? []).slice(0, 2);
    const [first, second] = pair;
    if (!first || !second || !summary) return null;
    return agreementBetween(summary.decisions, [first, second], stage);
  }, [summary, stage]);

  return (
    <div className="screening-panel">
      <div className="screening-toolbar">
        <span className="wf-seg" role="group" aria-label="Screening stage">
          {SCREENING_STAGES.map((s) => (
            <ToggleButton key={s} pressed={stage === s} onClick={() => setStage(s)}>
              {STAGE_LABEL[s]}
            </ToggleButton>
          ))}
        </span>
        <Button variant="ghost" size="sm" onClick={copyFigure} disabled={!summary}>
          Copy PRISMA figure
        </Button>
      </div>

      {error && <p className="error-text">{error}</p>}
      {msg && <p className="hint-text">{msg}</p>}

      {items.length === 0 ? (
        <p className="hint-text">Nothing in this list to screen yet.</p>
      ) : (
        <ul className="screening-rows">
          {items.map((item) => {
            const verdict = summary ? verdictFor(summary.decisions, item.id, stage) : null;
            const mine = decisionsFor(item.id).find((d) => d.reviewerId === me);
            const others = decisionsFor(item.id).filter((d) => d.reviewerId !== me);
            return (
              <li key={item.id} className="screening-row">
                <span className="screening-title">
                  {(item.paperId && titleById.get(item.paperId)) || "Untitled record"}
                  {item.duplicateOfItemId && <em> — duplicate</em>}
                </span>
                <span className="screening-verdict">
                  {verdict?.conflict
                    ? "reviewers disagree"
                    : verdict?.state
                      ? STATE_LABEL[verdict.state]
                      : "undecided"}
                  {others.length > 0 && ` (${others.length} other reviewer)`}
                </span>
                {!readOnly && (
                  <span className="screening-actions">
                    <input
                      className="screening-reason"
                      placeholder="reason"
                      value={reason[item.id] ?? mine?.reason ?? ""}
                      onChange={(e) =>
                        setReason((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                    />
                    <span className="wf-seg" role="group" aria-label="Decision">
                      {(Object.keys(STATE_LABEL) as ScreeningState[]).map((state) => (
                        <ToggleButton key={state} pressed={mine?.state === state} disabled={busy} onClick={() => decide(item.id, state)}>
                          {STATE_LABEL[state]}
                        </ToggleButton>
                      ))}
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {summary && (
        <div className="screening-counts">
          <table>
            <tbody>
              {COUNT_ROWS.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>{summary.counts[row.key]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {caveat && <p className="hint-text">{caveat}</p>}
          {agreement && agreement.compared > 0 && (
            <p className="hint-text">
              {`Two reviewers agreed on ${agreement.agreed} of ${agreement.compared} items`}
              {agreement.kappa === null
                ? " (kappa undefined — no disagreement to measure)."
                : ` (kappa ${agreement.kappa.toFixed(2)}).`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
