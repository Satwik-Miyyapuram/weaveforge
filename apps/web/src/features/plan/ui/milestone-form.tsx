"use client";

import { useState } from "react";
import { DatePicker } from "@/components/date-picker";
import {
  DEPENDENCY_KINDS,
  MILESTONE_STATUSES,
  type ComputeNeed,
  type DependencyKind,
  type Experiment,
  type Milestone,
  type MilestoneDependency,
  type MilestoneStatus,
  type Paper,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Select } from "@/components/select";
import { FormError } from "@/components/form-error";
import { formatError } from "@/lib/format-error";
import { statusLabel } from "@/components/status-select";

export interface DepDraft {
  kind: DependencyKind;
  refId: string;
  label: string;
}

export interface ComputeDraft {
  resource: string;
  count: string;
  hours: string;
  notes: string;
}

export interface MilestoneFormProps {
  initial?: Milestone;
  papers: Paper[];
  experiments: Experiment[];
  milestones: Milestone[];
  onSaved: () => void | Promise<void>;
  onCancel?: () => void;
}

export function MilestoneForm({
  initial,
  papers,
  experiments,
  milestones,
  onSaved,
  onCancel,
}: MilestoneFormProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? "");
  const [status, setStatus] = useState<MilestoneStatus>(initial?.status ?? "planned");
  const [deps, setDeps] = useState<DepDraft[]>(
    (initial?.dependencies ?? []).map((d) => {
      let refId = d.refId ?? "";
      if (!refId && d.kind !== "external" && d.label) {
        const opts = d.kind === "milestone" ? milestones : d.kind === "experiment" ? experiments : papers;
        const match = opts.find((o) => {
          const itemTitle = "title" in o ? o.title : "name" in o ? o.name : "";
          return itemTitle.trim().toLowerCase() === d.label?.trim().toLowerCase();
        });
        if (match) refId = match.id;
      }
      return {
        kind: d.kind,
        refId,
        label: d.label ?? "",
      };
    }),
  );
  const [compute, setCompute] = useState<ComputeDraft[]>(
    (initial?.compute ?? []).map((c) => ({
      resource: c.resource,
      count: c.count != null ? String(c.count) : "",
      hours: c.hours != null ? String(c.hours) : "",
      notes: c.notes ?? "",
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refOptions: Record<Exclude<DependencyKind, "external">, { id: string; label: string }[]> = {
    milestone: milestones
      .filter((m) => m.id !== initial?.id)
      .map((m) => ({ id: m.id, label: m.title })),
    experiment: experiments.map((e) => ({ id: e.id, label: e.name })),
    paper: papers.map((p) => ({ id: p.id, label: p.title })),
  };

  function patchDep(i: number, patch: Partial<DepDraft>) {
    setDeps((prev) => prev.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  }
  function patchCompute(i: number, patch: Partial<ComputeDraft>) {
    setCompute((prev) => prev.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const dependencies: MilestoneDependency[] = deps.map((d) =>
        d.kind === "external"
          ? { kind: d.kind, label: d.label.trim() }
          : { kind: d.kind, refId: d.refId, label: d.label || undefined },
      );
      const computeNeeds: ComputeNeed[] = compute.map((c) => ({
        resource: c.resource.trim(),
        count: c.count.trim() ? Number(c.count) : undefined,
        hours: c.hours.trim() ? Number(c.hours) : undefined,
        notes: c.notes.trim() || undefined,
      }));
      const plan = getContainer().plan;
      const { manageMilestone } = plan;
      if (initial) {
        await manageMilestone.update(initial.id, {
          title,
          description: description.trim() || undefined,
          status,
          targetDate,
          dependencies,
          compute: computeNeeds,
        });
      } else {
        const added = await manageMilestone.add({
          title,
          description: description.trim() || undefined,
          status,
          targetDate: targetDate || undefined,
          dependencies,
          compute: computeNeeds,
        });
        try { await plan.notifyMilestone("added", added); } catch { /* best-effort */ }
        setTitle("");
        setDescription("");
        setTargetDate("");
        setStatus("planned");
        setDeps([]);
        setCompute([]);
      }
      await onSaved();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={initial ? "add-form" : "card add-form"} onSubmit={submit}>
      <div className="field">
        <label htmlFor={`mtitle-${initial?.id ?? "new"}`}>Milestone</label>
        <input
          id={`mtitle-${initial?.id ?? "new"}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ablation study finished"
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`mdesc-${initial?.id ?? "new"}`}>Details</label>
        <textarea
          id={`mdesc-${initial?.id ?? "new"}`}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does done look like?"
        />
      </div>
      <div className="field-row-equal">
        <div className="field">
          <label htmlFor={`mdate-${initial?.id ?? "new"}`}>Target date</label>
          <DatePicker
            id={`mdate-${initial?.id ?? "new"}`}
            value={targetDate}
            onChange={setTargetDate}
          />
        </div>
        <div className="field">
          <label htmlFor={`mstatus-${initial?.id ?? "new"}`}>Status</label>
          <Select
            id={`mstatus-${initial?.id ?? "new"}`}
            value={status}
            onChange={(e) => setStatus(e.target.value as MilestoneStatus)}
          >
            {MILESTONE_STATUSES.map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </Select>
        </div>
      </div>

      <div className="field">
        <label>Dependencies</label>
        {deps.map((d, i) => (
          <div key={i} className="builder-row">
            <Select
              value={d.kind}
              onChange={(e) => patchDep(i, { kind: e.target.value as DependencyKind, refId: "" })}
              aria-label="Dependency kind"
            >
              {DEPENDENCY_KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </Select>
            {d.kind === "external" ? (
              <input
                value={d.label}
                onChange={(e) => patchDep(i, { label: e.target.value })}
                placeholder="dataset access, cluster account…"
                required
              />
            ) : (
              <Select
                value={d.refId}
                onChange={(e) => {
                  const refId = e.target.value;
                  const kind = d.kind as Exclude<DependencyKind, "external">;
                  const label = refOptions[kind]?.find((o) => o.id === refId)?.label ?? "";
                  patchDep(i, { refId, label });
                }}
                aria-label={`${d.kind} reference`}
              >
                <option value="">pick…</option>
                {refOptions[d.kind].map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </Select>
            )}
            <button
              type="button"
              className="link-btn danger"
              onClick={() => setDeps((prev) => prev.filter((_, k) => k !== i))}
              aria-label="Remove dependency"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="link-btn builder-add"
          onClick={() => setDeps((prev) => [...prev, { kind: "external", refId: "", label: "" }])}
        >
          + Add dependency
        </button>
      </div>

      <div className="field">
        <label>Compute needed</label>
        {compute.map((c, i) => (
          <div key={i} className="builder-row compute-row">
            <input
              value={c.resource}
              onChange={(e) => patchCompute(i, { resource: e.target.value })}
              placeholder="A100"
              required
            />
            <input
              type="number"
              min="1"
              value={c.count}
              onChange={(e) => patchCompute(i, { count: e.target.value })}
              placeholder="count"
              aria-label="Count"
            />
            <input
              type="number"
              min="0"
              value={c.hours}
              onChange={(e) => patchCompute(i, { hours: e.target.value })}
              placeholder="hours"
              aria-label="Hours"
            />
            <input
              value={c.notes}
              onChange={(e) => patchCompute(i, { notes: e.target.value })}
              placeholder="notes"
              aria-label="Notes"
            />
            <button
              type="button"
              className="link-btn danger"
              onClick={() => setCompute((prev) => prev.filter((_, k) => k !== i))}
              aria-label="Remove compute need"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="link-btn builder-add"
          onClick={() =>
            setCompute((prev) => [...prev, { resource: "", count: "", hours: "", notes: "" }])
          }
        >
          + Add compute
        </button>
      </div>

      {error && <FormError>{error}</FormError>}
      <div className={onCancel ? "card-foot edit-actions" : "card-foot form-foot"}>
        {onCancel && (
          <button type="button" className="btn-ghost btn-cancel" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        <button className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : initial ? "Save" : "Add milestone"}
        </button>
      </div>
    </form>
  );
}
