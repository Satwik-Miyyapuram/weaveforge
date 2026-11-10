"use client";

import { formatDateTime } from "@/lib/format-date";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { AiEvidence, AiWriteProposal } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { announceAiProposalsChanged } from "@/lib/ai-proposals-changed";
import { Markdown } from "@/components/markdown/markdown";
import { EntityCard } from "@/components/entity-card";
import { ScreenHead } from "@/components/screen-head";
import { EmptyState } from "@/components/empty-state";
import { NavIcon } from "@/app/nav-icon";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { buildLocusLink } from "@/features/reader";
import { loadCiteLinkCatalog, useWikilinkNavigation } from "@/lib/hooks/use-cite-links";
import { formatError } from "@/lib/format-error";
import { readyCore } from "@/lib/rust-core";
import { groupProposals, KIND_GROUP_PREFIX, runBulk, type ProposalGrouping } from "../application/proposal-groups";
import { useUndoWindow } from "./use-undo-window";
import { Button } from "@/components/button";
import { Chip } from "@/components/controls";

/** A proposal's text, rendered so its `[[links]]` are links, not brackets (E36). */
function ProposalMarkdown({ text }: { text: string }) {
  const { resolveWikilink, onWikilinkClick } = useWikilinkNavigation();
  const options = useMemo(() => ({ resolveWikilink }), [resolveWikilink]);
  return (
    <div className="wikilink-markdown-scope" onClick={onWikilinkClick}>
      <Markdown className="ai-proposal-content" options={options}>{text}</Markdown>
    </div>
  );
}

/** What a source id points at, once resolved to something a person can read. */
interface SourceTarget {
  title: string;
  href: string;
}

/**
 * Source ids resolved to titles.
 *
 * A proposal records what it read as entity ids, which is right for storage and
 * useless on screen: "Sources: d67bb6f5-970d-…" tells a reviewer nothing about
 * whether the evidence is a paper they trust. The cite-link catalog already
 * carries id → title → href for papers, notes, and report sections, which is
 * exactly the set a proposal can cite.
 */
function useSourceTargets(): Map<string, SourceTarget> {
  const [targets, setTargets] = useState<Map<string, SourceTarget>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    void loadCiteLinkCatalog()
      .then((catalog) => {
        if (cancelled) return;
        const next = new Map<string, SourceTarget>();
        for (const paper of catalog.papers) {
          next.set(paper.id, { title: paper.title, href: `/papers?paper=${encodeURIComponent(paper.id)}` });
        }
        for (const note of catalog.notes) {
          next.set(note.id, { title: note.title, href: `/notes?page=${encodeURIComponent(note.id)}` });
        }
        for (const section of catalog.sections) {
          next.set(section.id, {
            title: section.title,
            href: `/report?section=${encodeURIComponent(section.id)}`,
          });
        }
        setTargets(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return targets;
}

/** A source id shortened for display, for the ones nothing resolves. */
function unresolvedSourceLabel(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= 12) return trimmed;
  // A bare id is not worth 36 characters of a sentence; a URL keeps its shape.
  return /^[0-9a-f-]{32,}$/i.test(trimmed) ? `${trimmed.slice(0, 8)}…` : trimmed;
}

const label: Record<AiWriteProposal["kind"], string> = {
  append_paper_note: "Append to paper note", create_vault_note: "Create note",
  create_log_entry: "Create log entry", paper_update: "Paper update",
  paper_field_value: "Extraction field value",
  reading_list_change: "Reading-list change", relation: "Graph relation",
  zotero_import: "Zotero import", milestone_follow_up: "Milestone follow-up",
  experiment_follow_up: "Experiment follow-up",
  edit_vault_note: "Edit note", append_vault_note: "Append to note",
  report_edit: "Report section notes", milestone_status: "Milestone status",
  experiment_update: "Experiment update", paper_annotation: "Paper highlight",
};

function reviewHeading(item: AiWriteProposal): string {
  if (item.kind === "append_paper_note") return "Add this to the end of the paper note";
  if (item.kind === "paper_field_value") {
    const fieldId =
      typeof item.payload?.fieldId === "string" && item.payload.fieldId.trim()
        ? item.payload.fieldId.trim()
        : "field";
    const claimed =
      typeof item.payload?.fieldName === "string" && item.payload.fieldName.trim()
        ? item.payload.fieldName.trim()
        : null;
    // fieldId is authoritative; claimed name is an unverified MCP hint. So the
    // name leads — it is the only part a reader recognises — and the id
    // follows it, shortened, as the thing that decides where the value lands.
    const shown = unresolvedSourceLabel(fieldId);
    return claimed && claimed !== fieldId
      ? `Set field «${claimed}» (id ${shown}) on this paper`
      : `Set field ${shown} on this paper`;
  }
  return label[item.kind];
}

/** Card tint: green adds, yellow changes what is there, lilac links things. */
function toneFor(kind: AiWriteProposal["kind"]): string {
  switch (kind) {
    case "append_paper_note": case "create_vault_note": case "create_log_entry":
    case "append_vault_note": case "paper_annotation":
      return "done";
    case "relation": case "milestone_follow_up": case "experiment_follow_up": case "zotero_import":
      return "review";
    default:
      return "planned";
  }
}

function approveLabel(item: AiWriteProposal): string {
  if (item.kind === "append_paper_note") return "Approve and append";
  if (item.kind === "paper_field_value") return "Approve and write cell";
  return "Approve";
}

/** One piece of claim-level provenance: excerpt with the used sentence lit up. */
function EvidencePane({ evidence }: { evidence: AiEvidence }) {
  const highlight = useMemo(
    () => readyCore().highlightWithinExcerpt(evidence.excerpt, evidence.locus),
    [evidence.excerpt, evidence.locus],
  );
  const link = useMemo(() => {
    // Jump-to-passage only when we have a locus.
    if (evidence.paperId && evidence.locus) {
      return buildLocusLink({
        paperId: evidence.paperId,
        locus: evidence.locus,
        page: evidence.page,
      });
    }
    if (evidence.paperId) {
      // Always bind the open link to evidence.paperId (ignore spoofed app hrefs).
      return `/papers?paper=${encodeURIComponent(evidence.paperId)}`;
    }
    return readyCore().sanitizeReaderHref(evidence.href) ?? readyCore().sanitizeAppHref(evidence.href);
  }, [evidence.href, evidence.paperId, evidence.locus, evidence.page]);

  const locusMiss =
    Boolean(evidence.locus) && highlight == null;

  return (
    <div className="ai-evidence">
      <div className="ai-evidence-head">
        <span className="ai-evidence-source">{evidence.label ?? "Source"}</span>
        {highlight?.confidence === "low" && (
          <span className="ai-evidence-warn" title="The source may have changed since this was cited">
            Unverified match
          </span>
        )}
        {locusMiss && (
          <span className="ai-evidence-warn" title="The cited sentence could not be located in this excerpt">
            Locus not found
          </span>
        )}
      </div>
      <blockquote className="ai-evidence-excerpt">
        {highlight ? (
          <>
            <span className="ai-evidence-dim">{highlight.before}</span>
            <mark className="ai-evidence-mark">{highlight.match}</mark>
            <span className="ai-evidence-dim">{highlight.after}</span>
          </>
        ) : (
          <span>{evidence.excerpt}</span>
        )}
      </blockquote>
      {link && (
        <Link className="ai-evidence-open" href={link}>
          {evidence.locus ? "Open source at this passage →" : "Open source →"}
        </Link>
      )}
    </div>
  );
}

export function AiProposalReviewScreen() {
  const [items, setItems] = useState<AiWriteProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; title: string } | null>(null);
  const sourceTargets = useSourceTargets();
  // Keeps the current list on screen while reloading; no loading flash.
  const reload = useCallback(async () => {
    try { setItems(await getContainer().aiProposals.listPending()); setError(null); }
    catch (err) { setError(formatError(err)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const changed = () => announceAiProposalsChanged(getContainer().aiProposals);
  async function run(id: string, action: "approve" | "reject") {
    setBusy(id); setError(null); setCreated(null);
    const item = items.find((entry) => entry.id === id);
    try {
      let conflicted = false;
      let refreshFailed = false;
      if (action === "reject") await getContainer().aiProposals.reject(id);
      else {
        conflicted = (await getContainer().aiProposals.approve(id)) === "conflicted";
        // E27: a new note gets a link, not just a vanished card.
        // The approve already landed, so a failed page lookup must not read as a failed approve.
        if (!conflicted && item) {
          try {
            const pages = await getContainer().vault.listPages();
            const index = readyCore().createdPageIndex(item, pages) as number | null;
            const page = index === null ? null : pages[index];
            if (page) setCreated({ id: page.id, title: page.title });
          } catch { refreshFailed = true; }
        }
      }
      changed(); await reload();
      if (conflicted) setError("Not applied: the target changed since this was suggested.");
      else if (refreshFailed) setError("Approved, but the page list could not refresh.");
    } catch (err) { setError(formatError(err)); }
    finally { setBusy(null); }
  }
  async function approveAll() {
    if (!appendOnly.length) return;
    setBusy("all"); setError(null);
    try {
      const conflicted = await getContainer().aiProposals.approveSafeBatch(appendOnly.map((item) => item.id));
      changed(); await reload();
      if (conflicted) setError(`${conflicted} not applied: the target changed since it was suggested.`);
    }
    catch (err) { setError(formatError(err)); }
    finally { setBusy(null); }
  }
  const [grouping, setGrouping] = useState<ProposalGrouping>("document");
  const undoWindow = useUndoWindow();
  // Proposals waiting out the undo window leave the list, so the bulk action
  // reads as done; undo brings them back.
  const visible = useMemo(
    () => items.filter((item) => !undoWindow.scheduled?.ids.has(item.id)),
    [items, undoWindow.scheduled],
  );
  // Bulk approve only touches what the user sees, so it follows the filtered list.
  const appendOnly = visible.filter((item) => item.kind === "append_paper_note");
  const groups = useMemo(
    () => groupProposals(visible, grouping, [...sourceTargets.keys()]),
    [visible, grouping, sourceTargets],
  );
  function groupLabel(key: string): string {
    if (grouping === "kind") return label[key as AiWriteProposal["kind"]] ?? key;
    if (key.startsWith(KIND_GROUP_PREFIX)) {
      const kind = key.slice(KIND_GROUP_PREFIX.length) as AiWriteProposal["kind"];
      return label[kind] ?? kind;
    }
    return sourceTargets.get(key)?.title ?? unresolvedSourceLabel(key);
  }
  function bulk(ids: readonly string[], action: "approve" | "reject") {
    if (!ids.length) return;
    const count = `${ids.length} suggestion${ids.length === 1 ? "" : "s"}`;
    setError(null); setCreated(null);
    undoWindow.schedule(`${action === "approve" ? "Approving" : "Rejecting"} ${count}…`, ids, () => void (async () => {
      setBusy("all");
      try {
        const facade = getContainer().aiProposals;
        const result = await runBulk(ids, (id) => (action === "approve" ? facade.approve(id) : facade.reject(id)));
        changed(); await reload();
        const problems: string[] = [];
        if (result.conflicted.length) problems.push(`${result.conflicted.length} not applied: the target changed since it was suggested.`);
        if (result.failed) {
          problems.push(`Stopped: ${formatError(result.failed.error)} ${result.untouched.length + 1} still pending.`);
        }
        setError(problems.length ? problems.join(" ") : null);
      } catch (err) { setError(formatError(err)); }
      finally { setBusy(null); }
    })());
  }
  if (loading) return <ScreenLoader />;
  return <section className="screen ai-review-screen">
    <ScreenHead title="AI suggestions" eyebrow="AI safety"><Button href="/settings">AI settings</Button></ScreenHead>
    <p className="muted ai-review-lede">Nothing changes until you approve it.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {created && <p className="muted" role="status">Created &ldquo;{created.title}&rdquo;. <Link href={`/notes?page=${encodeURIComponent(created.id)}`}>Open page &rarr;</Link></p>}
    {undoWindow.scheduled && <div className="card ai-review-undo" role="status"><span>{undoWindow.scheduled.label}</span><Button variant="secondary" size="sm" onClick={undoWindow.undo}>Undo</Button></div>}
    {!items.length ? <EmptyState variant="first-run" icon={<NavIcon name="sparkle" />} title="Nothing to review" body="New AI suggestions will appear here before they can change your research workspace." /> : <>
      <div className="card ai-review-toolbar"><div><strong>{visible.length} pending suggestion{visible.length === 1 ? "" : "s"}</strong><span className="muted"> · Each one waits for you. Additions only add text; nothing is overwritten.</span></div>
        <div className="ai-review-bulk">
          {appendOnly.length > 1 && <Button variant="secondary" disabled={busy !== null} onClick={() => void approveAll()}>Approve the {appendOnly.length} that only add</Button>}
          {visible.length > 1 && <>
            <Button variant="cancel" disabled={busy !== null} onClick={() => bulk(visible.map((item) => item.id), "reject")}>Reject all</Button>
            <Button variant="primary" disabled={busy !== null} onClick={() => bulk(visible.map((item) => item.id), "approve")}>Approve all</Button>
          </>}
        </div>
      </div>
      {visible.length > 1 && <div className="ai-review-grouping" role="group" aria-label="Group suggestions">
        <span className="muted">Group by</span>
        <Chip pressed={grouping === "document"} onClick={() => setGrouping("document")}>Document</Chip>
        <Chip pressed={grouping === "kind"} onClick={() => setGrouping("kind")}>Kind</Chip>
      </div>}
      {groups.map((group) => <section key={group.key} className="ai-review-group" aria-label={groupLabel(group.key)}>
        <div className="ai-review-group-head">
          <h3>{groupLabel(group.key)} <span className="muted">({group.items.length})</span></h3>
          {group.items.length > 1 && <div className="ai-review-bulk">
            <Button variant="cancel" size="sm" disabled={busy !== null} onClick={() => bulk(group.items.map((item) => item.id), "reject")}>Reject {group.items.length}</Button>
            <Button variant="primary" size="sm" disabled={busy !== null} onClick={() => bulk(group.items.map((item) => item.id), "approve")}>Approve {group.items.length}</Button>
          </div>}
        </div>
      <div className="ai-review-list">{group.items.map((item) => {
        const evidence = item.evidence ?? [];
        const preview = readyCore().splitProposalContent(item.content);
        const title = preview.title ?? reviewHeading(item);
        return <EntityCard
          key={item.id}
          className={`ai-review-card${evidence.length ? " ai-review-card--split" : ""}`}
          tone={toneFor(item.kind)}
          title={title}
          // The kind is already the title when the suggestion has none of its own.
          badge={title === label[item.kind] ? undefined : <span className={`ai-kind ai-kind--${item.kind}`}>{label[item.kind]}</span>}
          meta={<><time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>{preview.why && <> · {preview.why}</>}</>}
        >
          <div className="ai-review-body">
            {preview.body && <div className="ai-review-proposed">
              {evidence.length > 0 && <h4 className="ai-review-colhead">Proposed write</h4>}
              <ProposalMarkdown text={preview.body} />
            </div>}
            {evidence.length > 0 && <div className="ai-review-evidence">
              <h4 className="ai-review-colhead">Evidence</h4>
              {evidence.map((ev, i) => <EvidencePane key={`${item.id}-${ev.sourceId}-${i}`} evidence={ev} />)}
            </div>}
          </div>
          {evidence.length === 0 && item.sourceLinks.length > 0 && (
            <p className="ai-review-sources muted">
              <span className="ai-review-sources-label">Sources</span>
              {item.sourceLinks.map((raw, i) => {
                const target = sourceTargets.get(raw.trim());
                const href = target?.href ?? readyCore().sanitizeReaderHref(raw) ?? readyCore().sanitizeAppHref(raw);
                const text = target?.title ?? unresolvedSourceLabel(raw);
                const key = `${item.id}-src-${i}`;
                return href ? (
                  <Link className="ai-review-source" key={key} href={href} title={raw}>
                    {text}
                  </Link>
                ) : (
                  <span className="ai-review-source" key={key} title={raw}>
                    {text}
                  </span>
                );
              })}
            </p>
          )}
          <div className="ai-review-actions"><Button variant="cancel" disabled={busy !== null} onClick={() => void run(item.id, "reject")}>Reject</Button><Button variant="primary" disabled={busy !== null} onClick={() => void run(item.id, "approve")}>{busy === item.id ? "Applying…" : approveLabel(item)}</Button></div>
        </EntityCard>;
      })}</div>
      </section>)}
    </>}
  </section>;
}
