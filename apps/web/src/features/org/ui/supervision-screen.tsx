"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  type LabSnapshot,
  type LogEntry,
  type Member,
  type Milestone,
  ROLE_LABELS,
} from "@weaveforge/core";
import { ScreenHead } from "@/components/screen-head";
import { EmptyState } from "@/components/empty-state";
import { NavIcon } from "@/app/nav-icon";
import { getContainer } from "@/bootstrap";
import { useProfile } from "./profile-provider";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { formatError } from "@/lib/format-error";
import { Select } from "@/components/select";
import { FormError } from "@/components/form-error";
import { statusLabel } from "@/components/status-select";
import { RowButton } from "@/components/controls";
import { Button } from "@/components/button";
import { CommentsToggle } from "@/features/sharing";
import { studentsOf } from "../application/students-of";

/**
 * Supervisor view: browse the people beneath you and follow their published
 * lab snapshots (preferred) plus live plan/logbook — read only, and separate
 * from your own projects.
 */
export function SupervisionScreen() {
  const { profile, team, loading, error } = useProfile();
  const searchParams = useSearchParams();
  const memberFromUrl = searchParams.get("member");

  // The people I supervise, at any depth; not my own supervisor.
  const supervisees = useMemo(() => studentsOf(profile?.id, team), [team, profile]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (memberFromUrl && supervisees.some((m) => m.id === memberFromUrl)) {
      setSelectedId(memberFromUrl);
      return;
    }
    setSelectedId((prev) => prev ?? supervisees[0]?.id ?? null);
  }, [memberFromUrl, supervisees]);

  if (loading) {
    return (
      <section className="screen">
        <ScreenLoader status="Loading supervision…" />
      </section>
    );
  }

  if (!profile && error) {
    return (
      <section className="screen">
        <p className="muted">Could not load your profile: {error}</p>
      </section>
    );
  }

  if (!profile || profile.role === "masters") {
    return (
      <section className="screen">
        <p className="muted">You don&rsquo;t supervise anyone.</p>
      </section>
    );
  }

  const selected = supervisees.find((m) => m.id === selectedId) ?? null;

  return (
    <section className="screen superv-screen">
      <ScreenHead
        title="Supervision"
        eyebrow={`You supervise ${supervisees.length} ${supervisees.length === 1 ? "person" : "people"}`}
      >
        {supervisees.length > 0 && (
          <Button href="/shared">
            Sharing
          </Button>
        )}
      </ScreenHead>
      {supervisees.length === 0 ? (
        <EmptyState
          variant="first-run"
          icon={<NavIcon name="flag" />}
          title="No students yet"
          body="Ask your org admin to assign students to you."
          action={
            <Button variant="primary" href="/shared">
              Open sharing
            </Button>
          }
        />
      ) : (
        <div className="superv-layout">
          <nav className="card superv-team" aria-label="Your team">
            <h3 className="superv-team-head">Your team</h3>
            <ul>
              {supervisees.map((m) => (
                <li key={m.id} style={{ paddingLeft: depthOf(m, supervisees) * 18 }}>
                  <RowButton
                    className={`superv-team-item${m.id === selectedId ? " is-active" : ""}`}
                    aria-current={m.id === selectedId ? "true" : undefined}
                    onClick={() => setSelectedId(m.id)}
                  >
                    <span className={`superv-avatar superv-avatar--${m.role}`} aria-hidden>{initials(m)}</span>
                    <span className="superv-team-info">
                      <span className="superv-team-name">{m.fullName || m.email || "Unnamed"}</span>
                      <span className="superv-team-role">{ROLE_LABELS[m.role]}</span>
                    </span>
                  </RowButton>
                </li>
              ))}
            </ul>
          </nav>
          {selected && <SuperviseePanel key={selected.id} member={selected} />}
        </div>
      )}
    </section>
  );
}

/** What a Live or Snapshot badge means, for its tooltip. */
function sourceTitle(frozen: boolean): string {
  return frozen ? "Snapshot: as the student published it" : "Live: current data, not a published snapshot";
}

/** How far below the nearest supervisee without a supervisor in this list. */
function depthOf(member: Member, all: Member[]): number {
  let depth = 0;
  let cur = member;
  const byId = new Map(all.map((m) => [m.id, m]));
  while (cur.supervisorId && byId.has(cur.supervisorId) && depth < 8) {
    cur = byId.get(cur.supervisorId)!;
    depth++;
  }
  return depth;
}

function initials(member: Member): string {
  const name = member.fullName?.trim() || member.email || "?";
  const parts = name.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function SuperviseePanel({ member }: { member: Member }) {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [snapshots, setSnapshots] = useState<LabSnapshot[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ms, ls, snaps] = await getContainer().org.loadSupervisee(member.id);
      setMilestones(ms);
      setLogs(ls);
      setSnapshots(snaps);
      setSelectedSnapshotId(snaps[0]?.id ?? null);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, [member.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="muted">Loading {member.fullName || member.email}…</p>;
  if (error) return <FormError>{error}</FormError>;

  const selectedSnapshot = snapshots.find((s) => s.id === selectedSnapshotId) ?? null;
  const showFrozen = selectedSnapshot != null;
  const displayMilestones = showFrozen ? selectedSnapshot.content.milestones : milestones;
  const displayLogs = showFrozen ? selectedSnapshot.content.logs : logs;

  return (
    <div className="superv-panels">
      <div className="card add-form superv-snapshots">
        <h3 className="settings-group">Check-ins ({snapshots.length})</h3>
        {snapshots.length === 0 ? (
          <p className="muted">
            No check-ins yet. Live plan and logbook are shown below until they send one.
          </p>
        ) : (
          <>
            <label className="muted superv-reviewing" htmlFor="superv-snapshot">
              Reviewing
            </label>
            <Select
              id="superv-snapshot"
              value={selectedSnapshotId ?? ""}
              onChange={(event) => setSelectedSnapshotId(event.target.value || null)}
              aria-label="Reviewing"
            >
              {snapshots.map((snap) => (
                <option key={snap.id} value={snap.id}>
                  {snap.title} · {snap.publishedAt.slice(0, 10)}
                </option>
              ))}
            </Select>
            {selectedSnapshot?.content.aiAssisted !== undefined && (
              <p className="muted superv-meta">
                AI-assisted: {selectedSnapshot.content.aiAssisted} accepted{" "}
                {selectedSnapshot.content.aiAssisted === 1 ? "suggestion" : "suggestions"}
              </p>
            )}
            {selectedSnapshot?.note && (
              <div className="superv-note">
                <span className="superv-note-label">Note from {member.fullName?.split(" ")[0] || "them"}</span>
                <p className="superv-body">{selectedSnapshot.note}</p>
              </div>
            )}
            {selectedSnapshot && (
              <CommentsToggle
                variant="detail"
                resourceType="lab_snapshot"
                resourceId={selectedSnapshot.id}
                canComment
              />
            )}
          </>
        )}
      </div>

      <div className="card add-form">
        <h3 className="settings-group superv-panel-head">
          <span>Milestones ({displayMilestones.length})</span>
          <span
            className={`superv-source superv-source--${showFrozen ? "snapshot" : "live"}`}
            title={sourceTitle(showFrozen)}
          >
            {showFrozen ? "Snapshot" : "Live"}
          </span>
        </h3>
        {displayMilestones.length === 0 ? (
          <p className="muted">No milestones yet.</p>
        ) : (
          <ul className="superv-list">
            {displayMilestones.map((m) => (
              <li key={m.id} className="superv-item">
                <div className="superv-item-head">
                  <span className="superv-item-title">{m.title}</span>
                  <span className={`superv-status s-${m.status}`}>{statusLabel(m.status)}</span>
                </div>
                {"targetDate" in m && m.targetDate && (
                  <span className="muted superv-meta">Target date {m.targetDate}</span>
                )}
                {"description" in m && m.description && (
                  <p className="superv-body">{m.description}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card add-form">
        <h3 className="settings-group superv-panel-head">
          <span>Logbook ({displayLogs.length})</span>
          <span
            className={`superv-source superv-source--${showFrozen ? "snapshot" : "live"}`}
            title={sourceTitle(showFrozen)}
          >
            {showFrozen ? "Snapshot" : "Live"}
          </span>
        </h3>
        {displayLogs.length === 0 ? (
          <p className="muted">No log entries yet.</p>
        ) : (
          <ul className="superv-list">
            {displayLogs.map((l) => (
              <li key={l.id} className="superv-item superv-log-item">
                <time className="superv-log-date">{l.entryDate}</time>
                <div>
                  <span className={`superv-status s-${l.kind}`}>{statusLabel(l.kind)}</span>
                  <p className="superv-body">{l.body}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedSnapshot?.content.experiments && (
        <div className="card add-form">
          <h3 className="settings-group superv-panel-head">
            <span>Experiments ({selectedSnapshot.content.experiments.length})</span>
            <span className="superv-source superv-source--snapshot">Snapshot</span>
          </h3>
          {selectedSnapshot.content.experiments.length === 0 ? (
            <p className="muted">No experiments yet.</p>
          ) : (
            <ul className="superv-list">
              {selectedSnapshot.content.experiments.map((e) => (
                <li key={e.id} className="superv-item">
                  <div className="superv-item-head">
                    <span className="superv-item-title">{e.name}</span>
                    <span className={`superv-status s-${e.status}`}>{statusLabel(e.status)}</span>
                  </div>
                  {e.resultNote && <p className="superv-body">{e.resultNote}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {selectedSnapshot?.content.report && (
        <div className="card add-form">
          <h3 className="settings-group superv-panel-head">
            <span>Report progress ({selectedSnapshot.content.report.length})</span>
            <span className="superv-source superv-source--snapshot">Snapshot</span>
          </h3>
          {selectedSnapshot.content.report.length === 0 ? (
            <p className="muted">No report sections yet.</p>
          ) : (
            <ul className="superv-list">
              {selectedSnapshot.content.report.map((r) => (
                <li key={r.id} className="superv-item">
                  <div className="superv-item-head">
                    <span className="superv-item-title">{r.title}</span>
                    <span className={`superv-status s-${r.status}`}>{statusLabel(r.status)}</span>
                  </div>
                  <span className="muted superv-meta">{r.wordCount} words</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
