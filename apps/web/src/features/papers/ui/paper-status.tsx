"use client";

import { PAPER_STATUSES, type PaperStatus } from "@weaveforge/core";
import { RecordDots } from "@/components/record";
import { Select } from "@/components/select";

/** How far through a paper each status is, as filled dots out of three. */
export const STATUS_DOTS: Record<PaperStatus, number> = { to_read: 0, reading: 1, skimmed: 2, read: 3 };

export function statusLabel(status: PaperStatus): string {
  return status.replace("_", " ");
}

/**
 * Reading status as dots and a word — the same control on the card and on the
 * paper's page. A borderless select, so a grid of cards is not a grid of
 * dropdowns, but still one click to change.
 */
export function PaperStatusControl({
  status,
  disabled,
  onChange,
}: {
  status: PaperStatus;
  disabled?: boolean;
  onChange: (status: PaperStatus) => void;
}) {
  return (
    <span className="record-state">
      <RecordDots filled={STATUS_DOTS[status]} label={`Status: ${statusLabel(status)}`} />
      <Select
        className="record-state-select"
        value={status}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as PaperStatus)}
        aria-label="Reading status"
      >
        {PAPER_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
      </Select>
    </span>
  );
}
