"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  highlightWithinExcerpt,
  type AiEvidence,
  type AiWriteProposal,
} from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { Markdown } from "@/components/markdown";
import { ScreenLoader } from "@/components/thesis-loader";
import { buildLocusLink, locusLinkIsResolvable, sanitizeReaderHref } from "@/features/reader";

const label: Record<AiWriteProposal["kind"], string> = {
  append_paper_note: "Append to paper note", create_vault_note: "Create vault note",
  create_log_entry: "Create log entry", paper_update: "Paper update",
  reading_list_change: "Reading-list change", relation: "Graph relation",
  zotero_import: "Zotero import", milestone_follow_up: "Milestone follow-up",
  experiment_follow_up: "Experiment follow-up",
};

/** One piece of claim-level provenance: excerpt with the used sentence lit up. */
function EvidencePane({ evidence }: { evidence: AiEvidence }) {
  const highlight = useMemo(
    () => highlightWithinExcerpt(evidence.excerpt, evidence.locus),
    [evidence.excerpt, evidence.locus],
  );
  const link = useMemo(() => {
    // Prefer rebuilding from paperId so a stored `/reader?pdf=…` cannot swap the source.
    if (locusLinkIsResolvable({ paperId: evidence.paperId })) {
      return buildLocusLink({ paperId: evidence.paperId, locus: evidence.locus, page: evidence.page });
    }
    return sanitizeReaderHref(evidence.href);
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
          Open source at this passage →
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
    <div className="screen-header"><div><p className="eyebrow">AI safety</p><h1>Review suggestions</h1><p className="muted">Nothing changes until you approve it. Suggestions are encrypted until this unlocked browser reviews them.</p></div><Link className="secondary-btn" href="/settings">AI settings</Link></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!items.length ? <div className="card empty-state"><h2>Nothing to review</h2><p>New AI suggestions will appear here before they can change your research workspace.</p></div> : <>
      <div className="ai-review-toolbar"><strong>{items.length} pending suggestion{items.length === 1 ? "" : "s"}</strong>{appendOnly.length > 1 && <button className="primary-btn" disabled={busy !== null} onClick={() => void approveAll()}>Approve all safe additions</button>}</div>
      <div className="ai-review-list">{items.map((item) => {
        const evidence = item.evidence ?? [];
        return <article className={`card ai-review-card${evidence.length ? " ai-review-card--split" : ""}`} key={item.id}>
          <div className="ai-review-card-head"><div><span className="ai-kind">{label[item.kind]}</span><h2>{item.kind === "append_paper_note" ? "Add this to the end of the paper note" : "Review required"}</h2></div><time>{new Date(item.createdAt).toLocaleString()}</time></div>
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
          {evidence.length === 0 && item.sourceLinks.length > 0 && <p className="muted">Sources: {item.sourceLinks.join(", ")}</p>}
          <div className="ai-review-actions"><button className="link-danger" disabled={busy !== null} onClick={() => void run(item.id, "reject")}>Reject</button><button className="primary-btn" disabled={busy !== null} onClick={() => void run(item.id, "approve")}>{busy === item.id ? "Applying…" : item.kind === "append_paper_note" ? "Approve and append" : "Approve"}</button></div>
        </article>;
      })}</div>
    </>}
  </section>;
}
