"use client";

import { useState } from "react";
import type { ReportSection } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Select } from "@/components/select";
import { formatError } from "@/lib/format-error";

export type ReportParentOption = { section: ReportSection; depth: number };

function parentOptionLabel({ section, depth }: ReportParentOption): string {
  const prefix = depth > 0 ? `${"\u00A0\u00A0".repeat(depth)}↳ ` : "";
  const no = section.sectionNo ? `${section.sectionNo} ` : "";
  return `${prefix}${no}${section.title}`;
}

/**
 * Add-section form. UI only: collects input and delegates to the manage
 * use-case via the container. `parentOptions` lists every owned section in
 * outline order so nesting can go several levels deep. No persistence here.
 */
export function AddSectionForm({
  parentOptions,
  onAdded,
}: {
  parentOptions: ReportParentOption[];
  onAdded?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [sectionNo, setSectionNo] = useState("");
  const [parentId, setParentId] = useState("");
  const [targetWords, setTargetWords] = useState("");
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await getContainer().report.manageReportSection.add({
        title,
        sectionNo: sectionNo.trim() || undefined,
        parentId: parentId || undefined,
        targetWords: targetWords.trim() ? Number(targetWords) : undefined,
        deadline: deadline || undefined,
      });
      setTitle("");
      setSectionNo("");
      setTargetWords("");
      setDeadline("");
      onAdded?.();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card add-form" onSubmit={submit}>
      <div className="field-row">
        <div className="field">
          <label htmlFor="title">Section title</label>
          <input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Background and related work"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="no">No.</label>
          <input
            id="no"
            value={sectionNo}
            onChange={(e) => setSectionNo(e.target.value)}
            placeholder="3.2"
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="parent">Under section</label>
        <Select
          id="parent"
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
        >
          <option value="">— top level —</option>
          {parentOptions.map((opt) => (
            <option key={opt.section.id} value={opt.section.id}>
              {parentOptionLabel(opt)}
            </option>
          ))}
        </Select>
      </div>
      <div className="field-row-equal">
        <div className="field">
          <label htmlFor="target">Target words</label>
          <input
            id="target"
            type="number"
            min="0"
            value={targetWords}
            onChange={(e) => setTargetWords(e.target.value)}
            placeholder="2000"
          />
        </div>
        <div className="field">
          <label htmlFor="deadline">Deadline</label>
          <input
            id="deadline"
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn-primary" disabled={busy}>
        {busy ? "Adding…" : "Add section"}
      </button>
    </form>
  );
}
