"use client";

import { Select } from "@/components/select";

/** "not_started" reads "Not started". */
export function statusLabel(status: string): string {
  const words = status.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The one status pill, tinted from the shared status map on every card and page. */
export function StatusSelect<S extends string>({
  value,
  statuses,
  onChange,
  disabled,
  label,
}: {
  value: S;
  statuses: readonly S[];
  onChange: (status: S) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <Select
      className="status-select"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as S)}
      aria-label={label}
    >
      {statuses.map((s) => (
        <option key={s} value={s}>{statusLabel(s)}</option>
      ))}
    </Select>
  );
}
