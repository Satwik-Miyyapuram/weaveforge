"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProject } from "@/features/projects";
import { useLayoutBreakpoint } from "@/lib/hooks/use-layout-breakpoint";
import { ChevronIcon } from "@/components/chevron-icon";
import { formatError } from "@/lib/format-error";
import { authHeaders } from "@/lib/auth-headers";
import { FormError } from "@/components/form-error";
import { ProjectChecks } from "./project-checks";
import { latestRequest } from "../lib/latest-request";
import { sectionWordCounts } from "../lib/section-word-counts";
import { type LinkedReport, type ReportContent, local, api } from "./linked-overleaf-api";
import { SectionTree } from "./overleaf-section-tree";
import { EditOverleafReportForm, LinkOverleafForm } from "./overleaf-report-forms";

export function LinkedOverleafReports() {
  const { current } = useProject();
  const { breakpoint } = useLayoutBreakpoint();
  const [reports, setReports] = useState<LinkedReport[]>([]);
  const [content, setContent] = useState<ReportContent | null>(null);
  const [selected, setSelected] = useState<LinkedReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // Per-section word targets for the open report; seeded when a report opens so
  // edits show instantly, then persisted to the report row.
  const [targets, setTargets] = useState<Record<string, number>>({});
  // Opening another report while a clone is in flight must not show the old one's content.
  const contentRequest = useRef(latestRequest()).current;

  /** Set (or clear, when words is null) one section's target and persist the map. */
  async function setSectionTarget(key: string, words: number | null) {
    if (!selected) return;
    const next = { ...targets };
    if (words == null) delete next[key];
    else next[key] = words;
    const prev = targets;
    setTargets(next); // optimistic
    try {
      const gateway = local();
      if (gateway) await gateway.patchReport({ id: selected.id, sectionTargets: next });
      else await api("/api/overleaf/reports", { method: "PATCH", body: JSON.stringify({ id: selected.id, sectionTargets: next }) });
      setReports((rs) => rs.map((r) => (r.id === selected.id ? { ...r, section_targets: next } : r)));
      setSelected((s) => (s && s.id === selected.id ? { ...s, section_targets: next } : s));
    } catch (err) {
      setTargets(prev);
      setError(formatError(err));
    }
  }

  /**
   * Removes the link row only. The Overleaf project is never touched — it stays
   * the source of truth, and re-linking needs nothing but the three fields back.
   */
  async function unlink(report: LinkedReport) {
    setError(null);
    try {
      const gateway = local();
      if (gateway) await gateway.deleteReport(report.id);
      else await api(`/api/overleaf/reports?id=${encodeURIComponent(report.id)}`, { method: "DELETE" });
      if (selected?.id === report.id) { setSelected(null); setContent(null); }
      setConfirmId(null);
      await reload();
    } catch (err) { setError(formatError(err)); }
  }

  const reload = useCallback(async () => {
    if (!current?.id) return;
    try {
      const gateway = local();
      const rows = gateway
        ? await gateway.listReports(current.id)
        : ((await api(`/api/overleaf/reports?projectId=${encodeURIComponent(current.id)}`)).reports ?? []);
      setReports((rows as LinkedReport[]).filter((report) => report.project_id === current.id));
      setError(null);
    }
    catch (err) { setError(formatError(err)); }
  }, [current?.id]);
  useEffect(() => { void reload(); }, [reload]);

  async function openReport(report: LinkedReport) {
    const isCurrent = contentRequest.begin();
    setSelected(report); setTargets(report.section_targets ?? {}); setContent(null); setLoading(true); setError(null);
    try {
      const gateway = local();
      let next: ReportContent;
      if (gateway) {
        next = await gateway.readContent(report) as ReportContent;
      } else {
        const response = await fetch(`/api/overleaf/reports/${encodeURIComponent(report.id)}/content`, { headers: await authHeaders(), cache: "no-store" });
        const payload = await response.json() as ReportContent & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Could not fetch the Overleaf report.");
        next = payload;
      }
      if (isCurrent()) setContent(next);
    } catch (err) { if (isCurrent()) setError(formatError(err)); }
    finally { if (isCurrent()) setLoading(false); }
  }

  if (!current?.id) return null;
  return (
    <details
      className="card linked-overleaf-card"
      {...(breakpoint === "desktop" ? { open: true } : {})}
    >
      <summary className="linked-overleaf-summary">
        <span className="list-toggle linked-overleaf-toggle" aria-hidden>
          <ChevronIcon variant="expand" size={16} />
        </span>
        <div className="linked-overleaf-summary-main">
          <p className="eyebrow">External report</p>
          <h2>Overleaf reports</h2>
          <p className="muted">Read-only here. Full LaTeX editing and compilation happen in Overleaf.</p>
        </div>
      </summary>
      <div className="linked-overleaf-body">
        <div className="linked-overleaf-head">
          <span className="muted" style={{ fontSize: "0.82rem" }}>
            {reports.length} linked
          </span>
          <button className="btn-secondary" type="button" onClick={() => setFormOpen((open) => !open)}>
            {formOpen ? "Cancel" : "Link report"}
          </button>
        </div>
        <p className="linked-overleaf-disclosure">
          {local()
            ? "When you view a linked report, this app fetches LaTeX source from Overleaf with the token kept in your computer's keychain. Nothing goes through a server of ours."
            : "When you view a linked report, WeaveForge's server fetches LaTeX source from Overleaf with your linked credentials."}
          {" "}That content stays in Overleaf (read-only here) and is not stored as WeaveForge project
          data — Overleaf&apos;s access controls apply to the source of truth.
        </p>
        {formOpen && <LinkOverleafForm projectId={current.id} onLinked={() => { setFormOpen(false); void reload(); }} onError={setError} />}
        <FormError>{error}</FormError>
        {!reports.length && !formOpen ? <p className="muted">No Overleaf reports linked to this project yet.</p> : <div className="linked-overleaf-list">{reports.map((report) => editingId === report.id ? (
          <EditOverleafReportForm
            key={report.id}
            report={report}
            onSaved={() => { setEditingId(null); void reload(); }}
            onCancel={() => setEditingId(null)}
            onError={setError}
          />
        ) : (
          <div className={`linked-overleaf-row${selected?.id === report.id ? " selected" : ""}`} key={report.id}>
            <button type="button" className="linked-overleaf-row__open" onClick={() => void openReport(report)}>
              <strong>{report.title}</strong>
              <small>{report.entry_file} · Overleaf project {report.overleaf_project_id}</small>
            </button>
            <div className="linked-overleaf-row__actions">
              {confirmId === report.id ? (
                <>
                  <span className="muted">Remove from this project? Overleaf keeps the document.</span>
                  <button type="button" className="link-btn" onClick={() => void unlink(report)}>Confirm</button>
                  <button type="button" className="link-btn btn-cancel" onClick={() => setConfirmId(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <button type="button" className="link-btn" onClick={() => void openReport(report)}>
                    {loading && selected?.id === report.id ? "Loading…" : "View"}
                  </button>
                  <button type="button" className="link-btn" onClick={() => { setEditingId(report.id); setConfirmId(null); }}>Edit</button>
                  <button type="button" className="link-btn" onClick={() => setConfirmId(report.id)}>Unlink</button>
                </>
              )}
            </div>
          </div>
        ))}</div>}
        {selected && <div className="linked-overleaf-content">
          <div className="linked-overleaf-toolbar"><strong>{selected.title}</strong><span>{content?.files.length ?? 0} source files</span><a className="link-btn" href={content?.overleafUrl ?? selected.external_url ?? `https://www.overleaf.com/project/${selected.overleaf_project_id}`} target="_blank" rel="noreferrer">Open in Overleaf ↗</a><button type="button" className="link-btn" onClick={() => void openReport(selected)}>Refresh</button></div>
          {content && (() => {
            const counts = sectionWordCounts(content.sectionTree.roots, content.files);
            const total = content.sectionTree.roots.reduce((sum, node) => sum + (counts.get(node.id) ?? 0), 0);
            return <><div className="linked-overleaf-sections-head"><h3>Sections</h3><span className="linked-overleaf-total">{total.toLocaleString()} words</span></div>{content.sectionTree.warnings.length > 0 && <p className="warning">{content.sectionTree.warnings.join(" ")}</p>}<ProjectChecks files={content.files} entryFile={content.entryFile} /><SectionTree roots={content.sectionTree.roots} files={content.files} counts={counts} targets={targets} onSetTarget={setSectionTarget} /><details className="linked-overleaf-source"><summary>View entry source</summary><pre>{content.files.find((file) => file.path === content.entryFile)?.content ?? "Entry file unavailable."}</pre></details></>;
          })()}
        </div>}
      </div>
    </details>
  );
}

