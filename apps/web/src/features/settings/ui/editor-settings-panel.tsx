"use client";

import { useEffect, useState } from "react";

import { Select } from "@/components/select";
import {
  WIKILINK_CREATE_LABELS,
  WIKILINK_CREATE_MODES,
  parseWikilinkCreateMode,
  readWikilinkCreateMode,
  writeWikilinkCreateMode,
  type WikilinkCreateMode,
} from "@/lib/wikilink-create-preference";

/**
 * The editor's own preferences: what a `[[link]]` to nothing does.
 *
 * A per-device preference like the paste rules, and stored the same way — it
 * is read inside a completion source, so it has to be synchronous.
 */
export function EditorSettingsPanel() {
  const [mode, setMode] = useState<WikilinkCreateMode>("create");
  useEffect(() => setMode(readWikilinkCreateMode()), []);

  const update = (next: WikilinkCreateMode) => {
    setMode(next);
    writeWikilinkCreateMode(next);
  };

  return (
    <div
      id="settings-editor"
      className="card add-form settings-anchor"
      role="tabpanel"
      aria-labelledby="settings-tab-editor"
    >
      <h3 className="settings-group">Editor</h3>
      <p className="muted jump-to-meta">
        How the editor behaves as you type. Stored in this browser alongside your theme.
      </p>

      <label className="field">
        <span>A <code>[[link]]</code> to a note that does not exist</span>
        <Select
          value={mode}
          onChange={(event) => update(parseWikilinkCreateMode(event.target.value))}
        >
          {WIKILINK_CREATE_MODES.map((option) => (
            <option key={option} value={option}>
              {WIKILINK_CREATE_LABELS[option]}
            </option>
          ))}
        </Select>
      </label>
      <p className="muted jump-to-meta">
        With creation on, the completion list offers a &ldquo;Create note&rdquo; row for an
        unknown title, and clicking an unresolved link in Read mode makes the note and opens it.
        Off, the link stays a placeholder.
      </p>
    </div>
  );
}
