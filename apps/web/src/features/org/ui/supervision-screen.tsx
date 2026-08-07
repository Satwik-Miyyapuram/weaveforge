"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  type LabSnapshot,
  type LogEntry,
  type Member,
  type Milestone,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { useProfile } from "./profile-provider";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { MemberTreeSelect } from "./member-tree";
import { formatError } from "@/lib/format-error";
import { Select } from "@/components/select";

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
    <section className="screen">
      {supervisees.length === 0 ? (
        <p className="muted">Nobody is assigned under you yet.</p>
      ) : (
        <>
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
          {selected && <SuperviseePanel key={selected.id} member={selected} />}
        </>
      )}
    </section>
  );
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
  if (error) return <p className="error">{error}</p>;

  const selectedSnapshot = snapshots.find((s) => s.id === selectedSnapshotId) ?? null;
  const showFrozen = selectedSnapshot != null;
  const displayMilestones = showFrozen ? selectedSnapshot.content.milestones : milestones;
  const displayLogs = showFrozen ? selectedSnapshot.content.logs : logs;

  return (
    <div className="superv-panels">
      <div className="card add-form">
        <h3 className="settings-group">Published snapshots ({snapshots.length})</h3>
        {snapshots.length === 0 ? (
          <p className="muted">
            No published snapshots yet. Live plan and logbook are shown below until they publish one.
          </p>
        ) : (
          <>
            <label className="muted" htmlFor="superv-snapshot">
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
              <p className="superv-body">{selectedSnapshot.note}</p>
            )}
          </>
        )}
      </div>

      <div className="card add-form">
        <h3 className="settings-group">
          Milestones ({displayMilestones.length})
          {showFrozen ? " · snapshot" : " · live"}
        </h3>
        {displayMilestones.length === 0 ? (
          <p className="muted">No milestones yet.</p>
        ) : (
          <ul className="superv-list">
            {displayMilestones.map((m) => (
              <li key={m.id} className="superv-item">
                <div className="superv-item-head">
                  <span className="superv-item-title">{m.title}</span>
                  <span className={`superv-status s-${m.status}`}>{m.status.replace("_", " ")}</span>
                </div>
                {"targetDate" in m && m.targetDate && (
                  <span className="muted">Target {m.targetDate}</span>
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
        <h3 className="settings-group">
          Logbook ({displayLogs.length})
          {showFrozen ? " · snapshot" : " · live"}
        </h3>
        {displayLogs.length === 0 ? (
          <p className="muted">No log entries yet.</p>
        ) : (
          <ul className="superv-list">
            {displayLogs.map((l) => (
              <li key={l.id} className="superv-item">
                <div className="superv-item-head">
                  <span className="superv-item-title">{l.entryDate}</span>
                  <span className="muted">{l.kind}</span>
                </div>
                <p className="superv-body">{l.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
