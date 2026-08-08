"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  highlightWithinExcerpt,
  type AiEvidence,
  type AiWriteProposal,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Markdown } from "@/components/markdown";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { buildLocusLink, sanitizeAppHref, sanitizeReaderHref } from "@/features/reader";
import { loadCiteLinkCatalog } from "@/lib/use-cite-links";

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
  append_paper_note: "Append to paper note", create_vault_note: "Create vault note",
  create_log_entry: "Create log entry", paper_update: "Paper update",
  paper_field_value: "Extraction field value",
  reading_list_change: "Reading-list change", relation: "Graph relation",
  zotero_import: "Zotero import", milestone_follow_up: "Milestone follow-up",
  experiment_follow_up: "Experiment follow-up",
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
    // fieldId is authoritative; claimed name is an unverified MCP hint.
    return claimed && claimed !== fieldId
      ? `Set field ${fieldId} (claimed «${claimed}») on this paper`
      : `Set field ${fieldId} on this paper`;
  }
  return "Review required";
}

function approveLabel(item: AiWriteProposal): string {
  if (item.kind === "append_paper_note") return "Approve and append";
  if (item.kind === "paper_field_value") return "Approve and write cell";
  return "Approve";
}

/** One piece of claim-level provenance: excerpt with the used sentence lit up. */
function EvidencePane({ evidence }: { evidence: AiEvidence }) {
  const highlight = useMemo(
    () => highlightWithinExcerpt(evidence.excerpt, evidence.locus),
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
    return sanitizeReaderHref(evidence.href) ?? sanitizeAppHref(evidence.href);
  }, [evidence.href, evidence.paperId, evidence.locus, evidence.page]);

  const locusMiss =
    Boolean(evidence.locus) && highlight == null;

  return (
    <div className="ai-evidence">
      <div className="ai-evidence-head">
        <span className="ai-evidence-source">{evidence.label ?? "Source"}</span>
        {highlight?.confidence === "low" && (
          <span className="ai-evidence-warn" title="The source may have changed since this was cited">
            unverified match
          </span>
        )}
        {locusMiss && (
          <span className="ai-evidence-warn" title="The cited sentence could not be located in this excerpt">
            locus not found
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
  const sourceTargets = useSourceTargets();
  const reload = useCallback(async () => {
    setLoading(true);
    try { setItems(await getContainer().aiProposals.listPending()); setError(null); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const appendOnly = useMemo(() => items.filter((item) => item.kind === "append_paper_note"), [items]);
  const changed = () => window.dispatchEvent(new Event("ai-proposals-changed"));
  async function run(id: string, action: "approve" | "reject") {
    setBusy(id); setError(null);
    try {
      if (action === "approve") await getContainer().aiProposals.approve(id);
      else await getContainer().aiProposals.reject(id);
      changed(); await reload();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(null); }
  }
  async function approveAll() {
    if (!appendOnly.length) return;
    setBusy("all"); setError(null);
    try { await getContainer().aiProposals.approveSafeBatch(appendOnly.map((item) => item.id)); changed(); await reload(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(null); }
  }
  if (loading) return <ScreenLoader />;
  return <section className="screen ai-review-screen">
    <div className="screen-header"><div><p className="eyebrow">AI safety</p><h1>Review suggestions</h1><p className="muted">Nothing changes until you approve it. Suggestions are encrypted until this unlocked browser reviews them.</p></div><Link className="btn-secondary" href="/settings">AI settings</Link></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!items.length ? <div className="card empty-state"><h2>Nothing to review</h2><p>New AI suggestions will appear here before they can change your research workspace.</p></div> : <>
      <div className="ai-review-toolbar"><strong>{items.length} pending suggestion{items.length === 1 ? "" : "s"}</strong>{appendOnly.length > 1 && <button className="btn-primary" disabled={busy !== null} onClick={() => void approveAll()}>Approve all safe additions</button>}</div>
      <div className="ai-review-list">{items.map((item) => {
        const evidence = item.evidence ?? [];
        return <article className={`card ai-review-card${evidence.length ? " ai-review-card--split" : ""}`} key={item.id}>
          <div className="ai-review-card-head"><div><span className="ai-kind">{label[item.kind]}</span><h2>{reviewHeading(item)}</h2></div><time>{new Date(item.createdAt).toLocaleString()}</time></div>
          <div className="ai-review-body">
            <div className="ai-review-proposed">
              <h3 className="ai-review-colhead">Proposed write</h3>
              <Markdown className="ai-proposal-content">{item.content}</Markdown>
            </div>
            {evidence.length > 0 && <div className="ai-review-evidence">
              <h3 className="ai-review-colhead">Evidence</h3>
              {evidence.map((ev, i) => <EvidencePane key={`${item.id}-${ev.sourceId}-${i}`} evidence={ev} />)}
            </div>}
          </div>
          {evidence.length === 0 && item.sourceLinks.length > 0 && (
            <p className="ai-review-sources muted">
              <span className="ai-review-sources-label">Sources</span>
              {item.sourceLinks.map((raw, i) => {
                const target = sourceTargets.get(raw.trim());
                const href = target?.href ?? sanitizeReaderHref(raw) ?? sanitizeAppHref(raw);
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
          <div className="ai-review-actions"><button className="btn-secondary danger" disabled={busy !== null} onClick={() => void run(item.id, "reject")}>Reject</button><button className="btn-primary" disabled={busy !== null} onClick={() => void run(item.id, "approve")}>{busy === item.id ? "Applying…" : approveLabel(item)}</button></div>
        </article>;
      })}</div>
    </>}
  </section>;
}
