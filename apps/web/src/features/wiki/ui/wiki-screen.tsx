"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { LintFinding, WikiPagePlan } from "@weaveforge/core";
import { Modal } from "@/components/modal";
import { formatError } from "@/lib/format-error";
import {
  activeProviderLabel,
  onProviderChange,
} from "@/features/ai-assistant/application/ai-provider-session";
import {
  applyMerge,
  previewMerge,
  previewWikiBuild,
  wikiSourceDocuments,
  proposeMissingPage,
  proposeWikiPages,
  regenerateWikiIndex,
  runWikiLint,
  type WikiBuildPreview,
} from "../application/build-wiki";

/**
 * Wiki: draft concept pages from what you have written, and keep them healthy.
 *
 * The build step never writes. It previews what it would create, and approval
 * happens in the review queue like any other assistant write — so a run that
 * proposes forty pages is a list you can read, not forty pages that appeared.
 */
export function WikiScreen() {
  const [preview, setPreview] = useState<WikiBuildPreview | null>(null);
  const [lint, setLint] = useState<Awaited<ReturnType<typeof runWikiLint>> | null>(null);
  const [busy, setBusy] = useState<"scan" | "queue" | "lint" | "index" | "fix" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [merge, setMerge] = useState<{ primaryId: string; secondaryId: string } | null>(null);
  const [provider, setProvider] = useState(activeProviderLabel);
  const [indexed, setIndexed] = useState<string | null>(null);
  const [sources, setSources] = useState<{ id: string; title: string }[] | null>(null);
  const [scope, setScope] = useState<Set<string>>(new Set());

  // The provider is configured in Settings, which is a different tree; without
  // this the copy here would keep claiming the scan runs on-device after the
  // user has pointed at a model.
  useEffect(() => onProviderChange(() => setProvider(activeProviderLabel())), []);

  const refreshLint = useCallback(async () => {
    setBusy("lint");
    setError(null);
    try {
      setLint(await runWikiLint());
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void refreshLint();
  }, [refreshLint]);

  /** Show the documents so a scan can be narrowed before it costs anything. */
  async function chooseSources() {
    setBusy("scan");
    setError(null);
    try {
      const documents = await wikiSourceDocuments();
      setSources(documents.map((doc) => ({ id: doc.id, title: doc.title })));
      setScope(new Set(documents.map((doc) => doc.id)));
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(null);
    }
  }

  async function scan(sourceIds?: readonly string[]) {
    setBusy("scan");
    setError(null);
    setQueued(null);
    try {
      const result = await previewWikiBuild(undefined, sourceIds);
      setPreview(result);
      // Everything proposed starts selected: the common case is accepting the
      // scan, and unticking a few is less work than ticking most.
      setSelected(new Set(result.plans.map((plan) => plan.title)));
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(null);
    }
  }

  async function queue() {
    if (!preview) return;
    setBusy("queue");
    setError(null);
    try {
      const chosen = preview.plans.filter((plan) => selected.has(plan.title));
      setQueued(await proposeWikiPages(chosen));
      setPreview(null);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(null);
    }
  }

  async function rebuildIndex() {
    setBusy("index");
    setError(null);
    try {
      const { pages } = await regenerateWikiIndex();
      setIndexed(`Index rebuilt — ${pages} page${pages === 1 ? "" : "s"} listed.`);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(null);
    }
  }

  /** Queue a page for every link that points at one that does not exist. */
  async function fixDeadLinks(targets: readonly string[]) {
    setBusy("fix");
    setError(null);
    try {
      for (const target of targets) await proposeMissingPage(target);
      setIndexed(
        `Queued ${targets.length} missing page${targets.length === 1 ? "" : "s"} for review.`,
      );
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(null);
    }
  }

  function toggle(plan: WikiPagePlan) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(plan.title)) next.delete(plan.title);
      else next.add(plan.title);
      return next;
    });
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <h2>Wiki</h2>
        <p className="muted">
          Concept pages drafted from your notes and papers. Nothing is written until you approve
          it in the review queue.
        </p>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="card add-form">
        <h3 className="settings-group">Draft new pages</h3>
        <p className="muted">
          Scans your notes and papers for concepts that come up repeatedly and drafts a page for
          each.{" "}
          {provider ? (
            <>
              Using <strong>{provider.label}</strong> · {provider.model}, called straight from this
              browser.
            </>
          ) : (
            <>
              Runs entirely on this device — no API key needed. Point at a model in{" "}
              <Link href="/settings#settings-provider">Settings</Link> for a closer read.
            </>
          )}
        </p>
        <div className="screen-actions">
          <button className="btn-secondary" type="button" disabled={busy !== null} onClick={() => void scan()}>
            {busy === "scan" && !sources ? "Scanning…" : "Scan everything"}
          </button>
          {/* With a model configured a scan costs the user money per document,
              so narrowing it has to be reachable before running, not after. */}
          <button
            className="btn-ghost"
            type="button"
            disabled={busy !== null}
            onClick={() => (sources ? setSources(null) : void chooseSources())}
          >
            {sources ? "Cancel" : "Choose what to scan…"}
          </button>
        </div>

        {sources && (
          <>
            <p className="muted">
              {scope.size} of {sources.length} selected.{" "}
              <button className="link-btn" type="button" onClick={() => setScope(new Set())}>
                Select none
              </button>{" "}
              <button
                className="link-btn"
                type="button"
                onClick={() => setScope(new Set(sources.map((source) => source.id)))}
              >
                Select all
              </button>
            </p>
            <ul className="wiki-plan-list wiki-source-list">
              {sources.map((source) => (
                <li key={source.id}>
                  <label className="field-inline">
                    <input
                      type="checkbox"
                      className="themed-check"
                      checked={scope.has(source.id)}
                      onChange={() =>
                        setScope((prev) => {
                          const next = new Set(prev);
                          if (next.has(source.id)) next.delete(source.id);
                          else next.add(source.id);
                          return next;
                        })
                      }
                    />
                    <span>{source.title}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="screen-actions">
              <button
                className="btn-primary"
                type="button"
                disabled={busy !== null || scope.size === 0}
                onClick={() => void scan([...scope])}
              >
                {busy === "scan" ? "Scanning…" : `Scan ${scope.size} document${scope.size === 1 ? "" : "s"}`}
              </button>
            </div>
          </>
        )}

        {queued !== null && (
          <p className="muted">
            Queued {queued} page{queued === 1 ? "" : "s"} for review.{" "}
            <Link href="/ai-review">Review them now</Link>.
          </p>
        )}

        {preview && (
          <>
            <p className="muted">
              Scanned {preview.documentsScanned} document{preview.documentsScanned === 1 ? "" : "s"}
              {preview.extractorId === "model" ? " with your model" : " on this device"}.{" "}
              {preview.plans.length} new page{preview.plans.length === 1 ? "" : "s"} to propose
              {preview.alreadyCovered > 0 && `, ${preview.alreadyCovered} already covered`}.
            </p>

            {preview.plans.length === 0 ? (
              <p className="muted">Nothing new to add — the wiki already covers what was found.</p>
            ) : (
              <>
                <ul className="wiki-plan-list">
                  {preview.plans.map((plan) => (
                    <li key={plan.title}>
                      <label className="field-inline">
                        <input
                          type="checkbox"
                          className="themed-check"
                          checked={selected.has(plan.title)}
                          onChange={() => toggle(plan)}
                        />
                        <span>
                          <strong>{plan.title}</strong>
                          <span className="jump-to-meta">
                            {" "}
                            · {plan.mentions} mention{plan.mentions === 1 ? "" : "s"} in{" "}
                            {plan.sourceDocumentIds.length} document
                            {plan.sourceDocumentIds.length === 1 ? "" : "s"}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="screen-actions">
                  <button
                    className="btn-primary"
                    type="button"
                    disabled={busy !== null || selected.size === 0}
                    onClick={() => void queue()}
                  >
                    {busy === "queue" ? "Queueing…" : `Send ${selected.size} for review`}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className="card add-form">
        <h3 className="settings-group">Health</h3>
        <p className="muted">
          Duplicates, links to pages that do not exist, and pages nothing connects to.
        </p>
        <div className="screen-actions">
          <button className="btn-secondary" type="button" disabled={busy !== null} onClick={() => void refreshLint()}>
            {busy === "lint" ? "Checking…" : "Re-check"}
          </button>
          <button className="btn-secondary" type="button" disabled={busy !== null} onClick={() => void rebuildIndex()}>
            {busy === "index" ? "Rebuilding…" : "Rebuild index page"}
          </button>
        </div>
        {indexed && <p className="muted">{indexed}</p>}

        {lint && lint.report.findings.length === 0 && (
          <p className="muted">Nothing to fix.</p>
        )}

        {lint && lint.steps.length > 0 && (
          <>
            <p className="muted">
              Fix in this order — merging duplicates changes which links are broken, so it comes
              first.
            </p>
            {lint.steps.map((step) => (
              <div key={step.kind}>
                <h4 className="settings-group">
                  {step.description} ({step.findings.length})
                </h4>
                {step.kind === "dead-link" && (
                  <div className="screen-actions">
                    <button
                      className="link-btn"
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        void fixDeadLinks([
                          ...new Set(
                            step.findings
                              .map((finding) => finding.target)
                              .filter((target): target is string => !!target),
                          ),
                        ])
                      }
                    >
                      {busy === "fix" ? "Queueing…" : "Queue a page for each missing link"}
                    </button>
                  </div>
                )}
                <ul className="wiki-lint-list">
                  {step.findings.slice(0, 20).map((finding: LintFinding, index) => (
                    <li key={`${finding.pageId}-${index}`} data-severity={finding.severity}>
                      {finding.message}
                      {finding.relatedPageId && (
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() =>
                            setMerge({ primaryId: finding.relatedPageId!, secondaryId: finding.pageId })
                          }
                        >
                          Merge…
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {step.findings.length > 20 && (
                  <p className="muted jump-to-meta">…and {step.findings.length - 20} more.</p>
                )}
              </div>
            ))}
          </>
        )}
      </div>
      {merge && (
        <MergeDialog
          primaryId={merge.primaryId}
          secondaryId={merge.secondaryId}
          onClose={() => setMerge(null)}
          onMerged={() => {
            setMerge(null);
            void refreshLint();
          }}
        />
      )}
    </section>
  );
}

/**
 * Confirm a merge by showing what it produces.
 *
 * Contradictions are called out specifically, because they are the one thing a
 * merge cannot decide: both statements survive, and someone has to choose.
 */
function MergeDialog({
  primaryId,
  secondaryId,
  onClose,
  onMerged,
}: {
  primaryId: string;
  secondaryId: string;
  onClose: () => void;
  onMerged: () => void;
}) {
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewMerge>>>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void previewMerge(primaryId, secondaryId)
      .then(setPreview)
      .catch((err) => setError(formatError(err)));
  }, [primaryId, secondaryId]);

  return (
    <Modal title="Merge pages" onClose={onClose}>
      {error && <p className="error">{error}</p>}
      {!preview ? (
        <p className="muted">Preparing…</p>
      ) : (
        <>
          <p className="muted">
            “{preview.secondaryTitle}” is folded into “{preview.primaryTitle}”, which keeps the
            title. Links to the old name keep working — it is recorded as an alias.
          </p>

          {preview.result.contradictions.length > 0 && (
            <p className="error">
              {preview.result.contradictions.length} statement
              {preview.result.contradictions.length === 1 ? "" : "s"} disagree. Both sides are kept
              under “Conflicting notes” for you to resolve — the merge will not pick one.
            </p>
          )}

          <pre className="wiki-merge-preview">{preview.result.body}</pre>

          <div className="screen-actions">
            <button className="btn-ghost" type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn-primary"
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                void applyMerge(primaryId, secondaryId, preview.result)
                  .then(onMerged)
                  .catch((err) => {
                    setError(formatError(err));
                    setBusy(false);
                  });
              }}
            >
              {busy ? "Merging…" : "Merge"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
