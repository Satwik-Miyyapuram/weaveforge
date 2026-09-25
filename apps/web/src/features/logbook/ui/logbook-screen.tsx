"use client";

import { useCallback, useMemo, useState } from "react";
import { LOG_KINDS, type LogEntry, type LogKind } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ScreenLoading } from "@/components/screen-loading";
import { AddLogEntryForm } from "./add-log-entry-form";
import { Select } from "@/components/select";
import { Markdown } from "@/components/markdown/markdown";
import { EntityCard } from "@/components/entity-card";
import { EntityCardMenu } from "@/components/entity-card-menu";
import { DeleteIcon, EditIcon } from "@/components/view-icons";
import { EmptyState } from "@/components/empty-state";
import { NavIcon } from "@/app/nav-icon";
import { CollabBodyHost } from "@/features/collab";
import { useScreenData } from "@/lib/hooks/use-screen-data";
import { emptyArray } from "@/lib/empty";
import { formatError } from "@/lib/format-error";
import { ScreenHead } from "@/components/screen-head";
import { FormError } from "@/components/form-error";

/**
 * Logbook screen. Presentation + view-state only; all data access goes through
 * the repository obtained from the container.
 */
export function LogbookScreen() {
  const [addOpen, setAddOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  const loadEntries = useCallback(() => getContainer().logbook.loadEntries(), []);
  const { data, loading, error, reload: load } = useScreenData("logbook", loadEntries);
  const entries = data ?? emptyArray<LogEntry>();
  const days = useMemo(() => groupByDay(entries), [entries]);

  if (loading) {
    return <ScreenLoading status="Loading logbook…" />;
  }

  return (
    <section className="screen">
      <ScreenHead eyebrow={logEyebrow(entries)}>
        <button type="button" className="btn-secondary" onClick={() => setPublishOpen(true)}>
          Publish snapshot
        </button>
        <button className="btn-primary" onClick={() => setAddOpen(true)}>New entry</button>
      </ScreenHead>

      {addOpen && (
        <Modal title="Add a log entry" onClose={() => setAddOpen(false)}>
          <AddLogEntryForm onAdded={() => { setAddOpen(false); void load(); }} />
        </Modal>
      )}

      {publishOpen && (
        <Modal title="Publish lab snapshot" onClose={() => setPublishOpen(false)}>
          <PublishLabSnapshotForm onPublished={() => setPublishOpen(false)} />
        </Modal>
      )}

      {error && <FormError>{error}</FormError>}
      {!error && entries.length === 0 && (
        <EmptyState
          variant="first-run"
          icon={<NavIcon name="calendar" />}
          title="No log entries yet"
          body="The logbook is the part you will be glad of in month seven: what you tried today, and what it told you. One line is enough to start."
          action={
            <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>
              New entry
            </button>
          }
        />
      )}

      {entries.length > 0 && (
        <div className="log-layout">
          <ol className={`log-timeline ${entries.length > 20 ? "long-list" : ""}`}>
            {days.map(([date, dayEntries], i) => (
              <li key={date} className="log-day">
                <DayMark
                  date={date}
                  showMonth={date.slice(0, 7) !== (i === 0 ? ymdOf(new Date()) : days[i - 1]![0]).slice(0, 7)}
                />
                <ul className="log-list">
                  {dayEntries.map((e) => (
                    <LogItem key={e.id} entry={e} onChanged={load} />
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <aside className="log-side" aria-label="Logbook overview">
            <LogCalendar entries={entries} />
            <LogKinds entries={entries} />
          </aside>
        </div>
      )}
    </section>
  );
}

function PublishLabSnapshotForm({ onPublished }: { onPublished: () => void }) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await getContainer().org.publishLabSnapshot({ title, note: note || undefined });
      onPublished();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="add-form" onSubmit={(event) => void submit(event)}>
      <p className="muted">
        Freezes this project&rsquo;s current milestones and log entries for your supervisor.
      </p>
      <label>
        Title
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          placeholder="Week 12 check-in"
        />
      </label>
      <label>
        Note to supervisor (optional)
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          placeholder="What should they focus on?"
        />
      </label>
      {error && <FormError>{error}</FormError>}
      <button type="submit" className="btn-primary" disabled={busy || !title.trim()}>
        {busy ? "Publishing…" : "Publish"}
      </button>
    </form>
  );
}

function LogItem({ entry, onChanged }: { entry: LogEntry; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const { headline, rest } = splitHeadline(entry.body);

  async function remove() {
    if (!confirm(`Delete log entry from ${entry.entryDate}?`)) return;
    await getContainer().logbook.addLogEntry.remove(entry.id);
    try { await getContainer().logbook.removeLog(entry); } catch { /* git sync best-effort */ }
    await onChanged();
  }

  if (editing) {
    return (
      <li className="card log-item">
        <EditLogForm
          entry={entry}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await onChanged();
          }}
        />
      </li>
    );
  }

  return (
    <EntityCard
      as="li"
      className="log-item"
      // Same card as papers, notes, experiments, milestones and report
      // sections: what identifies the row on the card, the occasional and
      // destructive controls behind one ⋯. A log entry has no share type yet,
      // so the menu carries Edit and Delete and gains Share with it.
      title={headline}
      status={<span className={`status status-${entry.kind}`}>{capitalise(entry.kind)}</span>}
      menu={
        <EntityCardMenu
          shareable={false}
          deleteLabel="Delete log entry"
          onDelete={() => void remove()}
          extraItems={[{ id: "edit", label: "Edit", onSelect: () => setEditing(true) }]}
        />
      }
    >
      {rest && <Markdown className="log-body">{rest}</Markdown>}
    </EntityCard>
  );
}

function EditLogForm({
  entry,
  onCancel,
  onSaved,
}: {
  entry: LogEntry;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [body, setBody] = useState(entry.body);
  const [kind, setKind] = useState<LogKind>(entry.kind);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const useCollab = getContainer().collab.enabled();

  /**
   * Autosave from the collaborative editor. Deliberately does *not* call
   * `onSaved` — that closes the form, and the editor saves while the user is
   * still typing in it. Keeping the local `body` in step means the Kind select
   * can be submitted later without clobbering collaborative edits.
   */
  async function saveBody(nextBody: string) {
    setBody(nextBody);
    const logbook = getContainer().logbook;
    const updated = await logbook.addLogEntry.update(entry.id, { body: nextBody, kind });
    try { await logbook.pushLog(updated); } catch { /* git sync best-effort */ }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const logbook = getContainer().logbook;
      const updated = await logbook.addLogEntry.update(entry.id, { body, kind });
      try { await logbook.pushLog(updated); } catch { /* git sync best-effort */ }
      await onSaved();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="add-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor={`body-${entry.id}`}>What did you do?</label>
        {useCollab ? (
          <CollabBodyHost
            resourceType="log_entry"
            resourceId={entry.id}
            initialBody={body}
            onSave={saveBody}
            className="vault-body-input vault-codemirror"
          />
        ) : (
          <textarea
            id={`body-${entry.id}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            required
          />
        )}
      </div>
      <div className="field">
        <label htmlFor={`kind-${entry.id}`}>Kind</label>
        <Select id={`kind-${entry.id}`} value={kind} onChange={(e) => setKind(e.target.value as LogKind)}>
          {LOG_KINDS.map((k) => (
            <option key={k} value={k}>{capitalise(k)}</option>
          ))}
        </Select>
      </div>
      {error && <FormError>{error}</FormError>}
      <div className="card-foot edit-actions">
        <button type="button" className="link-btn" onClick={onCancel} disabled={busy}>
          cancel
        </button>
        {/* In collab mode the body is already persisted by the editor's
            autosave, so this button is about leaving the form — but it still
            submits, because the Kind select is not collaborative and would
            otherwise have no way to be saved at all. */}
        <button className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : useCollab ? "Done" : "Save"}
        </button>
      </div>
    </form>
  );
}

/** Entries grouped by day, newest day first, in the order they arrived. */
function groupByDay(entries: readonly LogEntry[]): [string, LogEntry[]][] {
  const byDay = new Map<string, LogEntry[]>();
  for (const e of entries) {
    const list = byDay.get(e.entryDate);
    if (list) list.push(e);
    else byDay.set(e.entryDate, [e]);
  }
  return [...byDay.entries()].sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0));
}

/** A yyyy-mm-dd read as a local calendar date, not UTC midnight. */
function localDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function ymdOf(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The body's first line is the card's title and the rest its text, so a
 * one-line entry is all headline. Leading heading marks are dropped.
 */
function splitHeadline(body: string): { headline: string; rest: string } {
  const trimmed = body.trim();
  const cut = trimmed.indexOf("\n");
  const first = cut < 0 ? trimmed : trimmed.slice(0, cut);
  const rest = cut < 0 ? "" : trimmed.slice(cut + 1).trim();
  return { headline: first.replace(/^#+\s*/, "") || "Untitled entry", rest };
}

/** Consecutive days with an entry, counting back from today (or yesterday). */
function streakDays(entries: readonly LogEntry[]): number {
  const logged = new Set(entries.map((e) => e.entryDate));
  const day = new Date();
  if (!logged.has(ymdOf(day))) day.setDate(day.getDate() - 1);
  let streak = 0;
  while (logged.has(ymdOf(day))) {
    streak++;
    day.setDate(day.getDate() - 1);
  }
  return streak;
}

/** "62 entries · 9-day streak" above the title. */
function logEyebrow(entries: readonly LogEntry[]): string | undefined {
  if (!entries.length) return undefined;
  const count = `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`;
  const streak = streakDays(entries);
  return streak > 1 ? `${count} · ${streak}-day streak` : count;
}

/** The timeline's gutter: the day of the month, big, and its weekday. */
/** The day number and weekday; the month too where it changes down the timeline. */
function DayMark({ date, showMonth }: { date: string; showMonth: boolean }) {
  const day = localDate(date);
  const today = ymdOf(new Date()) === date;
  const weekday = day.toLocaleDateString(undefined, { weekday: "short" });
  return (
    <div className="log-day-mark">
      <strong>{day.getDate()}</strong>
      <span>{today ? `${weekday}, today` : weekday}</span>
      {showMonth && (
        <span className="log-day-month">{day.toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>
      )}
    </div>
  );
}

/** This month, Monday first, with the days that have an entry stamped. */
function LogCalendar({ entries }: { entries: readonly LogEntry[] }) {
  const now = new Date();
  const logged = new Set(entries.map((e) => e.entryDate));
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  return (
    <div className="card log-calendar">
      <h2>{now.toLocaleDateString(undefined, { month: "long" })}</h2>
      <div className="log-calendar-grid" role="group" aria-label={`Days logged this month: ${[...logged].filter((d) => d.startsWith(ymdOf(first).slice(0, 7))).length}`}>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={`h${i}`} className="log-calendar-head" aria-hidden="true">{d}</span>
        ))}
        {cells.map((d, i) => {
          if (d == null) return <span key={`e${i}`} />;
          const ymd = ymdOf(new Date(now.getFullYear(), now.getMonth(), d));
          const cls = [
            "log-calendar-day",
            logged.has(ymd) ? "is-logged" : "",
            d === now.getDate() ? "is-today" : "",
          ].filter(Boolean).join(" ");
          return (
            <span key={ymd} className={cls} title={logged.has(ymd) ? `Logged ${ymd}` : undefined}>
              {d}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** How many entries of each kind. */
function LogKinds({ entries }: { entries: readonly LogEntry[] }) {
  return (
    <div className="card log-kinds">
      <h2>Kinds</h2>
      <ul>
        {LOG_KINDS.map((kind) => (
          <li key={kind}>
            <span className={`status status-${kind}`}>{capitalise(kind)}</span>
            <span className="log-kinds-count">{entries.filter((e) => e.kind === kind).length}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
