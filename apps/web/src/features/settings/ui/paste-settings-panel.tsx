"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildUrlCleanupOptions,
  cleanUrlsInText,
  DEFAULT_PASTE_SETTINGS,
  parseLinkRemovalText,
  type PasteSettings,
} from "@weaveforge/core";
import { readPasteSettings, writePasteSettings } from "@/lib/paste-cleanup-preference";

/**
 * The paste rules, with a live tester for the link rules.
 *
 * The tester is the point of the panel. A removal rule is a claim about a URL
 * you are not looking at, written in a syntax you have just read about, and the
 * only way to be sure of one is to see a real link before and after. The sample
 * box is pre-filled so the panel says something the moment it opens.
 */

const SAMPLE_LINKS = [
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxAbC123&si=8f2a1c&utm_source=share&t=42",
  "https://www.nature.com/articles/s41586-024-00001-2?utm_source=nature_etoc&error=cookies_not_supported",
  "https://doi.org/10.1145/3292500.3330701",
].join("\n");

type RuleKey = Exclude<keyof PasteSettings, "linkRemovals" | "cleanOnPaste">;

const RULES: { key: RuleKey; label: string; hint: string }[] = [
  {
    key: "cleanLinks",
    label: "Strip tracking from links",
    hint: "Campaign tags, click identifiers and scroll-to-text fragments. A DOI, an arXiv link and a signed download URL are never touched.",
  },
  {
    key: "normalizeInvisible",
    label: "Remove invisible characters",
    hint: "Zero-width spaces and bidirectional overrides go; non-breaking spaces become ordinary ones. Emoji and script joiners are left alone.",
  },
  {
    key: "stripEscapeSequences",
    label: "Strip terminal escape sequences",
    hint: "The colour and cursor codes that ride along with copied terminal output.",
  },
  {
    key: "linkIdentifiers",
    label: "Link a pasted DOI or arXiv id",
    hint: "A bare 10.1145/… becomes a link to doi.org, and arXiv:1706.03762 a link to the abstract. No network and no guess — both have one canonical resolver.",
  },
  {
    key: "tabsToTable",
    label: "Turn a spreadsheet paste into a table",
    hint: "Tab-separated rows copied from Excel, Numbers, Sheets or an HTML table become a Markdown table, with number columns right-aligned. Tabs only — comma-separated text is indistinguishable from prose.",
  },
  {
    key: "trimWhitespace",
    label: "Trim surrounding whitespace",
    hint: "Blank lines and stray spaces around the paste. Blank lines inside it stay.",
  },
  {
    key: "straightenQuotes",
    label: "Straighten quotes",
    hint: "Curly quotes and apostrophes become straight ones. Off by default, so typography you set deliberately is kept.",
  },
  {
    key: "straightenDashes",
    label: "Straighten dashes",
    hint: "En and em dashes become hyphens. Also off by default.",
  },
  {
    key: "cleanPdfOnPaste",
    label: "Repair PDF text automatically",
    hint: "Rejoin wrapped lines and mend hyphenated words when a paste looks like it came from a PDF. Off by default; the command below is the deliberate way to run it.",
  },
];

const SHORTCUTS: [string, string][] = [
  ["Clean up selection", "Ctrl/Cmd + Alt + C"],
  ["Clean up terminal output", "Ctrl/Cmd + Alt + T"],
  ["Clean up PDF text", "Ctrl/Cmd + Alt + P"],
  ["…and drop page numbers, joining it into one paragraph", "Ctrl/Cmd + Alt + Shift + P"],
  ["Turn a tab-separated selection into a table", "Ctrl/Cmd + Alt + Shift + T"],
  ["Move commas inside the quotes", "Ctrl/Cmd + Alt + ,"],
  ["Move commas outside the quotes", "Ctrl/Cmd + Alt + ."],
  ["Paste without cleaning", "Ctrl/Cmd + Shift + V"],
];

export function PasteSettingsPanel() {
  const [settings, setSettings] = useState<PasteSettings>(DEFAULT_PASTE_SETTINGS);
  const [removalText, setRemovalText] = useState("");
  const [sample, setSample] = useState(SAMPLE_LINKS);

  // Read after mount: there is no localStorage during the server render, and
  // seeding from the defaults would flash the wrong toggles for a frame.
  useEffect(() => {
    const stored = readPasteSettings();
    setSettings(stored);
    setRemovalText(stored.linkRemovals.join("\n"));
  }, []);

  const update = (next: PasteSettings) => {
    setSettings(next);
    writePasteSettings(next);
  };

  const commitRemovals = (text: string) => {
    setRemovalText(text);
    update({ ...settings, linkRemovals: parseLinkRemovalText(text) });
  };

  const preview = useMemo(() => {
    const options = buildUrlCleanupOptions(parseLinkRemovalText(removalText));
    return sample
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({ before: line, after: cleanUrlsInText(line, options).text }));
  }, [removalText, sample]);

  return (
    <div
      id="settings-paste"
      className="card add-form settings-anchor"
      role="tabpanel"
      aria-labelledby="settings-tab-paste"
    >
      <h3 className="settings-group">Paste</h3>
      <p className="muted jump-to-meta">
        What happens to text on its way into a note. Stored in this browser alongside your
        theme, so a shared machine and your own can answer differently.
      </p>

      <label className="field-inline">
        <input
          type="checkbox"
          className="themed-check"
          checked={settings.cleanOnPaste}
          onChange={(e) => update({ ...settings, cleanOnPaste: e.target.checked })}
        />
        Clean up every paste
      </label>
      <p className="muted jump-to-meta">
        The master switch. With it off nothing runs automatically, and the commands below
        still work on a selection.
      </p>

      {RULES.map((rule) => (
        <div className="field" key={rule.key}>
          <label className="field-inline">
            <input
              type="checkbox"
              className="themed-check"
              disabled={!settings.cleanOnPaste}
              checked={settings[rule.key]}
              onChange={(e) => update({ ...settings, [rule.key]: e.target.checked })}
            />
            {rule.label}
          </label>
          <p className="muted field-hint">{rule.hint}</p>
        </div>
      ))}

      <h3 className="settings-group">Link rules</h3>
      <p className="muted jump-to-meta">
        One rule per line, on top of the built-in list. <code>fbclid</code> removes that
        parameter everywhere. <code>site.example | source, ref</code> removes those two on
        that site and its subdomains. <code>google.*</code> matches every top-level domain.
        A line starting <code>!</code>, such as <code>!youtube.com</code>, switches the
        built-in rules off for one site.
      </p>
      <div className="field">
        <textarea
          rows={5}
          spellCheck={false}
          value={removalText}
          onChange={(e) => commitRemovals(e.target.value)}
          aria-label="Link removal rules"
          placeholder={"fbclid\nsite.example | source, ref\n!youtube.com"}
        />
      </div>

      <h3 className="settings-group">Try it</h3>
      <div className="field">
        <textarea
          rows={4}
          spellCheck={false}
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          aria-label="Sample links to test the rules against"
        />
      </div>
      {preview.map((row) => (
        <div className="field" key={row.before}>
          <p className="muted field-hint">{row.before}</p>
          <p className="field-hint">
            {row.after === row.before ? <span className="muted">unchanged</span> : row.after}
          </p>
        </div>
      ))}

      <h3 className="settings-group">Images</h3>
      <p className="muted jump-to-meta">
        Copy an image and paste it into a note: it uploads and the link appears where the
        caret was. Dragging one in works the same way. Screenshots are downscaled and
        re-encoded; animated GIFs are stored as they came, so the animation survives.
      </p>

      <h3 className="settings-group">Commands</h3>
      <p className="muted jump-to-meta">
        In any note editor: on the selection, or on the whole note when nothing is selected.
      </p>
      {SHORTCUTS.map(([label, keys]) => (
        <p className="muted field-hint" key={label}>
          {label} — <code>{keys}</code>
        </p>
      ))}
    </div>
  );
}
