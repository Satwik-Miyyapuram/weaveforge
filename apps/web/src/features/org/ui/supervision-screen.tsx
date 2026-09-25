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
import { getContainer } from "@/bootstrap";
import { useProfile } from "./profile-provider";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { MemberTreeSelect } from "./member-tree";
import { formatError } from "@/lib/format-error";
import { Select } from "@/components/select";
import { FormError } from "@/components/form-error";

/**
 * Supervisor view: browse the people beneath you and follow their published
 * lab snapshots (preferred) plus live plan/logbook — read only, and separate
 * from your own projects.
 */
export function SupervisionScreen() {
  const { profile, team, loading } = useProfile();
  const searchParams = useSearchParams();
  const memberFromUrl = searchParams.get("member");

  // Everyone in my subtree except me = the people I supervise (transitively).
  const supervisees = useMemo(
    () => team.filter((m) => m.id !== profile?.id),
    [team, profile],
  );

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
          <div className="superv-picker">
            <label className="muted" htmlFor="superv-select">Viewing</label>
            <MemberTreeSelect
              members={supervisees}
              selectedId={selectedId}
              onSelect={setSelectedId}
              meId={profile.id}
              placeholder="Select someone you supervise"
            />
          </div>
        )}
      </ScreenHead>
      {supervisees.length === 0 ? (
        <p className="muted">Nobody is assigned under you yet.</p>
      ) : (
        <div className="superv-layout">
          <nav className="card superv-team" aria-label="Your team">
            <h3 className="superv-team-head">Your team</h3>
            <ul>
              {supervisees.map((m) => (
                <li key={m.id} style={{ paddingLeft: depthOf(m, supervisees) * 18 }}>
                  <button
                    type="button"
                    className={`superv-team-item${m.id === selectedId ? " is-active" : ""}`}
                    aria-current={m.id === selectedId ? "true" : undefined}
                    onClick={() => setSelectedId(m.id)}
                  >
                    <span className={`superv-avatar superv-avatar--${m.role}`} aria-hidden>{initials(m)}</span>
                    <span className="superv-team-name">{m.fullName || m.email || "Unnamed"}</span>
                    <span className="superv-team-role">{ROLE_LABELS[m.role]}</span>
                  </button>
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

function capitalise(text: string): string {
  const spaced = text.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
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
        <h3 className="settings-group">Published snapshots ({snapshots.length})</h3>
        {snapshots.length === 0 ? (
          <p className="muted">
            No published snapshots yet. Live plan and logbook are shown below until they publish one.
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
            {selectedSnapshot?.note && (
              <div className="superv-note">
                <span className="superv-note-label">Note from {member.fullName?.split(" ")[0] || "them"}</span>
                <p className="superv-body">{selectedSnapshot.note}</p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card add-form">
        <h3 className="settings-group superv-panel-head">
          <span>Milestones ({displayMilestones.length})</span>
          <span className={`superv-source superv-source--${showFrozen ? "snapshot" : "live"}`}>
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
                  <span className={`superv-status s-${m.status}`}>{capitalise(m.status)}</span>
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
          <span className={`superv-source superv-source--${showFrozen ? "snapshot" : "live"}`}>
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
                  <span className={`superv-status s-${l.kind}`}>{capitalise(l.kind)}</span>
                  <p className="superv-body">{l.body}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
