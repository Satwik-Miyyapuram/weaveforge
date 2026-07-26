"use client";

import { Select } from "@/components/select";
import {
  EDITOR_CITATION_FORMATS,
  EDITOR_CITATION_FORMAT_LABELS,
  type EditorCitationFormat,
} from "@/lib/citation-format-preference";

/** Compact picker for @-cite insert format (Phase C2). */
export function CitationFormatSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: EditorCitationFormat;
  onChange: (value: EditorCitationFormat) => void;
  disabled?: boolean;
}) {
  return (
    <label className="citation-format-select">
      <span className="muted">Cite as</span>
      <Select
        aria-label="Citation format"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as EditorCitationFormat)}
      >
        {EDITOR_CITATION_FORMATS.map((format) => (
          <option key={format} value={format}>
            {EDITOR_CITATION_FORMAT_LABELS[format]}
          </option>
        ))}
      </Select>
    </label>
  );
}
