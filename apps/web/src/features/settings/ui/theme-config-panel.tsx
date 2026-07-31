"use client";

import { useRef, useState } from "react";
import {
  parseThemeConfig,
  themeConfigTemplate,
  THEME_CONFIG_MAX_BYTES,
  type ThemeConfig,
} from "@thesis/core";
import { persistThemeChange } from "@/lib/theme-persistence";

/**
 * Upload / remove a `config.json` theme file.
 *
 * The file is validated by `parseThemeConfig` before anything is applied or
 * stored, and rejection is all-or-nothing: half a palette is unreadable, so a
 * file with one bad color is not partially applied. Every problem the parser
 * found is listed, because "invalid file" with no path is useless when the
 * file has forty keys.
 */
export function ThemeConfigPanel({
  current,
  onChange,
}: {
  current: ThemeConfig | null;
  onChange: (config: ThemeConfig | null) => void;
}) {
  const [errors, setErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | null) {
    setErrors([]);
    if (!file) return;
    // Checked before reading, not after: the point of a cap is to avoid
    // pulling an arbitrarily large file into memory in the first place.
    if (file.size > THEME_CONFIG_MAX_BYTES) {
      setErrors([`file: larger than ${Math.floor(THEME_CONFIG_MAX_BYTES / 1024)} KB`]);
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setErrors(["file: could not be read"]);
      return;
    }
    const { config, errors: problems } = parseThemeConfig(text);
    if (!config) {
      setErrors(problems);
      return;
    }
    persistThemeChange({
      customTheme: config,
      mode: config.mode,
      surfaces: config.surfaces,
      reactiveMotion: config.reactiveMotion,
    });
    onChange(config);
  }

  function remove() {
    setErrors([]);
    persistThemeChange({ customTheme: null });
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function downloadTemplate() {
    const blob = new Blob([themeConfigTemplate()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "config.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="field" style={{ marginTop: "16px" }}>
      <label htmlFor="theme-config-file">Theme file</label>
      <p className="muted" style={{ margin: "2px 0 8px" }}>
        Load a <code>config.json</code> to override colors, fonts and corner radii. Only
        known keys with recognised values are accepted — anything else is reported
        and nothing is applied.
      </p>

      <div className="theme-config-actions">
        <input
          ref={inputRef}
          id="theme-config-file"
          type="file"
          accept="application/json,.json"
          onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
        />
        <button type="button" className="btn-secondary" onClick={downloadTemplate}>
          Download template
        </button>
        {current && (
          <button type="button" className="btn-secondary" onClick={remove}>
            Remove theme
          </button>
        )}
      </div>

      {current && !errors.length && (
        <p className="muted" style={{ margin: "8px 0 0" }}>
          Active: <strong>{current.name}</strong> — {Object.keys(current.vars).length} tokens.
        </p>
      )}

      {errors.length > 0 && (
        <div className="theme-config-errors" role="alert">
          <p className="error" style={{ margin: "8px 0 4px" }}>
            Theme file rejected — nothing was applied.
          </p>
          <ul>
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
