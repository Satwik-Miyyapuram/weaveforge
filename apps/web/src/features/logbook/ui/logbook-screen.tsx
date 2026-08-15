"use client";

import { useCallback, useState } from "react";
import { LOG_KINDS, type LogEntry, type LogKind } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ScreenLoading } from "@/components/screen-loading";
import { AddLogEntryForm } from "./add-log-entry-form";
import { Select } from "@/components/select";
import { Markdown } from "@/components/markdown";
import { DeleteIcon, EditIcon } from "@/components/view-icons";
import { CollabBodyHost } from "@/features/collab";
import { useScreenData } from "@/lib/use-screen-data";
import { emptyArray } from "@/lib/empty";
import { formatError } from "@/lib/format-error";

/**
 * Logbook screen. Presentation + view-state only; all data access goes through
 * the repository obtained from the container.
 */
export function LogbookScreen() {
  const [addOpen, setAddOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  const loadEntries = useCallback(() => getContainer().logbook.loadEntries(), []);
  const { data, loading, error, reload: load } = useScreenData("logbook", loadEntries);
  const entries = data ?? emptyArray<import("@weaveforge/core").LogEntry>();

  if (loading) {
    return <ScreenLoading status="Loading logbook…" />;
  }

  return (
    <section className="screen">
      <header className="screen-head">
        <div className="head-row">
          <div className="screen-actions">
            <button className="btn-primary" onClick={() => setAddOpen(true)}>+ Entry</button>
            <button type="button" className="btn-secondary" onClick={() => setPublishOpen(true)}>
              Publish snapshot
            </button>
          </div>
        </div>
      </header>

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

      {error && <p className="error">{error}</p>}
      {!error && entries.length === 0 && (
        <div className="empty">
          <p>No log entries yet. Use “+ Entry” to record what you did today.</p>
        </div>
      )}

      <ul className={`log-list ${entries.length > 20 ? "long-list" : ""}`}>
        {entries.map((e) => (
          <LogItem key={e.id} entry={e} onChanged={load} />
        ))}
      </ul>
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
      {error && <p className="error">{error}</p>}
      <button type="submit" className="btn-primary" disabled={busy || !title.trim()}>
        {busy ? "Publishing…" : "Publish"}
      </button>
    </form>
  );
}

function LogItem({ entry, onChanged }: { entry: LogEntry; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);

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
    <li className="card log-item">
      <div className="log-head">
        <div className="log-meta">
          <span className="log-date">{entry.entryDate}</span>
          <span className={`status status-${entry.kind}`}>{entry.kind}</span>
        </div>
        <button
          className="entity-icon-btn log-edit"
          aria-label="Edit log entry"
          title="Edit"
          onClick={() => setEditing(true)}
        >
          <EditIcon />
        </button>
      </div>
      <Markdown className="log-body">{entry.body}</Markdown>
      <div className="card-foot">
        <button
          className="entity-icon-btn danger card-del"
          aria-label="Delete log entry"
          title="Delete"
          onClick={() => void remove()}
        >
          <DeleteIcon />
        </button>
      </div>
    </li>
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
            <option key={k} value={k}>{k}</option>
          ))}
        </Select>
      </div>
      {error && <p className="error">{error}</p>}
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
