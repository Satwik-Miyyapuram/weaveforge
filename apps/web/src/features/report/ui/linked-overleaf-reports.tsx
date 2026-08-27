"use client";

import { useCallback, useEffect, useState } from "react";
import type { LatexSectionNode } from "@weaveforge/core";
import { useProject } from "@/features/projects";
import { useLayoutBreakpoint } from "@/lib/hooks/use-layout-breakpoint";
import { ChevronIcon } from "@/components/chevron-icon";
import { formatError } from "@/lib/format-error";
import { authHeaders } from "@/lib/auth-headers";
import { isLocalMode } from "@/backend/providers/local/local-identity";
import { LocalOverleafGateway } from "@/features/overleaf/infrastructure/local-overleaf-gateway";

type LinkedReport = {
  id: string; project_id: string; title: string; connection_id: string; overleaf_project_id: string;
  entry_file: string; external_url: string | null; last_fetched_at: string | null;
  section_targets: Record<string, number>;
};
type ReportContent = { files: { path: string; content: string }[]; entryFile: string; sectionTree: { roots: LatexSectionNode[]; files: string[]; warnings: string[] }; overleafUrl: string };

/**
 * The rows, from wherever this copy keeps them.
 *
 * A copy working with no account has no API routes to call -- the desktop
 * build ships no server -- so the same six operations go straight to the local
 * database and the shell. Resolved once and remembered: the answer cannot
 * change without a reload, because the whole backend is wired at startup.
 */
let localGateway: LocalOverleafGateway | null | undefined;
function local(): LocalOverleafGateway | null {
  if (localGateway === undefined) localGateway = isLocalMode() ? new LocalOverleafGateway() : null;
  return localGateway;
}

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: { ...(await authHeaders({ "Content-Type": "application/json" })), ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({})) as { error?: string; reports?: LinkedReport[]; report?: LinkedReport; connection?: { id: string } };
  if (!response.ok) throw new Error(payload.error ?? "Overleaf request failed.");
  return payload;
}

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
    setSelected(report); setTargets(report.section_targets ?? {}); setContent(null); setLoading(true); setError(null);
    try {
      const gateway = local();
      if (gateway) {
        setContent(await gateway.readContent(report) as ReportContent);
      } else {
        const response = await fetch(`/api/overleaf/reports/${encodeURIComponent(report.id)}/content`, { headers: await authHeaders(), cache: "no-store" });
        const payload = await response.json() as ReportContent & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Could not fetch the Overleaf report.");
        setContent(payload);
      }
    } catch (err) { setError(formatError(err)); }
    finally { setLoading(false); }
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
        {error && <p className="error" role="alert">{error}</p>}
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
                  <button type="button" className="link-btn" onClick={() => setConfirmId(null)}>Cancel</button>
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
            const total = content.sectionTree.roots.reduce((sum, node) => sum + subtreeWords(node, content.files), 0);
            return <><div className="linked-overleaf-sections-head"><h3>Sections</h3><span className="linked-overleaf-total">{total.toLocaleString()} words</span></div>{content.sectionTree.warnings.length > 0 && <p className="warning">{content.sectionTree.warnings.join(" ")}</p>}<SectionTree roots={content.sectionTree.roots} files={content.files} targets={targets} onSetTarget={setSectionTarget} /><details className="linked-overleaf-source"><summary>View entry source</summary><pre>{content.files.find((file) => file.path === content.entryFile)?.content ?? "Entry file unavailable."}</pre></details></>;
          })()}
        </div>}
      </div>
    </details>
  );
}

type SourceFile = { path: string; content: string };

/**
 * The LaTeX text that belongs to a section itself — from just after its heading
 * up to its first child (or its end if it has none). Children render their own
 * bodies, so slicing here to the first child keeps each block non-overlapping.
 */
function sectionBody(node: LatexSectionNode, files: readonly SourceFile[]): string {
  const file = files.find((f) => f.path === node.file);
  if (!file) return "";
  const lines = file.content.replace(/\r\n/g, "\n").split("\n");
  const firstChild = node.children[0];
  const end = firstChild ? firstChild.startLine - 1 : node.endLine;
  // startLine is the heading line (1-based); body starts on the next line.
  return lines.slice(node.startLine, end).join("\n").trim();
}

/** Strip comments, commands and math punctuation so a word count reflects prose. */
function proseWords(latex: string): number {
  const text = latex
    .replace(/%.*$/gm, "")
    .replace(/\\[a-zA-Z]+\*?(\s*\[[^\]]*\])?(\s*\{[^}]*\})?/g, " ")
    .replace(/[{}$&~^_\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.split(" ").length : 0;
}

/** Words in a section including its subsections — the length a writer tracks. */
function subtreeWords(node: LatexSectionNode, files: readonly SourceFile[]): number {
  return proseWords(sectionBody(node, files)) + node.children.reduce((sum, child) => sum + subtreeWords(child, files), 0);
}

/** Stable-ish target key: lowercased title path, robust to line-number churn. */
function targetKey(path: readonly string[]): string {
  return path.join(" > ");
}

/** Collapsible section hierarchy; each heading opens to its own LaTeX body. */
function SectionTree({ roots, files, targets, onSetTarget, parentPath = [] }: {
  roots: LatexSectionNode[];
  files: readonly SourceFile[];
  targets: Record<string, number>;
  onSetTarget: (key: string, words: number | null) => void;
  parentPath?: readonly string[];
}) {
  if (!roots.length) return <p className="muted">No static section commands were found.</p>;
  return <div className="linked-overleaf-tree">{roots.map((node) => (
    <SectionNode key={node.id} node={node} files={files} targets={targets} onSetTarget={onSetTarget} parentPath={parentPath} />
  ))}</div>;
}

function SectionNode({ node, files, targets, onSetTarget, parentPath }: {
  node: LatexSectionNode;
  files: readonly SourceFile[];
  targets: Record<string, number>;
  onSetTarget: (key: string, words: number | null) => void;
  parentPath: readonly string[];
}) {
  const [editingTarget, setEditingTarget] = useState(false);
  const body = sectionBody(node, files);
  const hasBody = body.length > 0;
  const hasChildren = node.children.length > 0;
  const path = [...parentPath, (node.title || "(untitled)").toLowerCase()];
  const key = targetKey(path);
  const words = subtreeWords(node, files);
  const target = targets[key];
  const pct = target ? Math.min(100, Math.round((words / target) * 100)) : 0;

  function saveTarget(raw: string) {
    setEditingTarget(false);
    const trimmed = raw.trim();
    if (!trimmed) { if (target) onSetTarget(key, null); return; }
    const n = Number(trimmed);
    if (Number.isInteger(n) && n > 0) onSetTarget(key, n);
  }

  return (
    <details className="linked-overleaf-section" data-level={node.level}>
      <summary>
        <ChevronIcon variant="expand" size={14} />
        <span className="linked-overleaf-section__title">{node.title || <em>(untitled)</em>}</span>
        <span className="linked-overleaf-section__count">
          {target ? `${words.toLocaleString()} / ${target.toLocaleString()} words` : `${words.toLocaleString()} words`}
        </span>
        <small>{node.command} · {node.file}:{node.startLine}</small>
      </summary>
      <div className="linked-overleaf-section__body">
        {target && (
          <div className="linked-overleaf-section__progress" title={`${pct}% of target`}>
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="linked-overleaf-section__target">
          {editingTarget ? (
            <input
              type="number" min={1} autoFocus className="linked-overleaf-target-input"
              defaultValue={target ?? ""}
              placeholder="Target words"
              onBlur={(e) => saveTarget(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveTarget((e.target as HTMLInputElement).value); if (e.key === "Escape") setEditingTarget(false); }}
            />
          ) : (
            <button type="button" className="link-btn" onClick={() => setEditingTarget(true)}>
              {target ? "Edit target" : "Set target"}
            </button>
          )}
          {target && !editingTarget && (
            <button type="button" className="link-btn" onClick={() => onSetTarget(key, null)}>Clear</button>
          )}
        </div>
        {hasBody ? <pre>{body}</pre> : <p className="muted">No text directly under this heading.</p>}
        {hasChildren && <SectionTree roots={node.children} files={files} targets={targets} onSetTarget={onSetTarget} parentPath={path} />}
      </div>
    </details>
  );
}

/**
 * Edits this app's link row — title, which Overleaf project it points at, and
 * the entry file. Nothing here writes to Overleaf; changing the project id just
 * re-points the link, and the next fetch clones the new target.
 *
 * The connection (token) is deliberately not editable here: it belongs to the
 * account, not to one report.
 */
function EditOverleafReportForm({ report, onSaved, onCancel, onError }: {
  report: LinkedReport;
  onSaved: () => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); onError("");
    const form = new FormData(event.currentTarget);
    try {
      const patch = {
        id: report.id,
        title: String(form.get("title") ?? ""),
        overleafProjectId: String(form.get("overleafProjectId") ?? ""),
        entryFile: String(form.get("entryFile") ?? ""),
      };
      const gateway = local();
      if (gateway) await gateway.patchReport(patch);
      else await api("/api/overleaf/reports", { method: "PATCH", body: JSON.stringify(patch) });
      onSaved();
    } catch (err) { onError(formatError(err)); }
    finally { setBusy(false); }
  }
  return (
    <form className="linked-overleaf-form linked-overleaf-form--edit" onSubmit={(event) => void submit(event)}>
      <label>Report title<input name="title" required defaultValue={report.title} /></label>
      <label>Overleaf project ID<input name="overleafProjectId" required defaultValue={report.overleaf_project_id} /></label>
      <label>Entry file<input name="entryFile" required defaultValue={report.entry_file} /></label>
      <div className="linked-overleaf-form__actions">
        <button className="btn-primary" disabled={busy} type="submit">{busy ? "Saving…" : "Save changes"}</button>
        <button className="btn-secondary" disabled={busy} type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function LinkOverleafForm({ projectId, onLinked, onError }: { projectId: string; onLinked: () => void; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); onError("");
    const form = new FormData(event.currentTarget);
    try {
      const gateway = local();
      const link = {
        projectId,
        title: String(form.get("title") ?? ""),
        overleafProjectId: String(form.get("overleafProjectId") ?? ""),
        entryFile: String(form.get("entryFile") ?? "main.tex"),
      };
      if (gateway) {
        const connectionId = await gateway.saveConnection(
          String(form.get("connectionName") ?? ""),
          String(form.get("token") ?? ""),
        );
        await gateway.createReport({ ...link, connectionId });
      } else {
        const connection = await api("/api/overleaf/connections", { method: "POST", body: JSON.stringify({ name: form.get("connectionName"), token: form.get("token") }) });
        await api("/api/overleaf/reports", { method: "POST", body: JSON.stringify({ ...link, connectionId: connection.connection?.id }) });
      }
      onLinked();
    } catch (err) { onError(formatError(err)); }
    finally { setBusy(false); }
  }
  return <form className="linked-overleaf-form" onSubmit={(event) => void submit(event)}><label>Connection name<input name="connectionName" required placeholder="My Overleaf account" /></label><label>Overleaf Git token<input name="token" type="password" required autoComplete="off" /></label><label>Report title<input name="title" required placeholder="MSc thesis" /></label><label>Overleaf project ID<input name="overleafProjectId" required placeholder="1234567" /></label><label>Entry file<input name="entryFile" defaultValue="main.tex" required /></label><button className="btn-primary" disabled={busy} type="submit">{busy ? "Linking…" : "Save and link report"}</button></form>;
}
