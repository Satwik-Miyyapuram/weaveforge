"use client";

import { useCallback, useEffect, useState } from "react";
import { desktop, type DesktopStorageArea } from "@/lib/desktop/desktop-bridge";
import { formatError } from "@/lib/format-error";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/button";

/**
 * Settings → Data → the app's own folders on this computer: saved artifacts,
 * downloaded models and the log, each with its size and a Clear button.
 * Desktop only; a browser has no such folders, so nothing renders.
 */

const LABELS: Record<string, { name: string; note: string }> = {
  artifacts: { name: "Saved artifacts", note: "Files tools saved for you on this computer." },
  models: { name: "Downloaded models", note: "Downloaded again the next time they are needed." },
  log: { name: "Application log", note: "The record of what went wrong. Starts again empty." },
};

/** A size as a reader says it: "Empty", "512 bytes", "1.5 KB", "5.0 MB". */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "Empty";
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(1)} ${units[unit]}`;
}

export function StoragePanel() {
  const [areas, setAreas] = useState<DesktopStorageArea[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = Boolean(desktop()?.storageUsage);

  const load = useCallback(async () => {
    const bridge = desktop();
    if (!bridge?.storageUsage) return;
    try {
      setAreas(await bridge.storageUsage());
    } catch (err) {
      setError(formatError(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const clear = async (id: string) => {
    setBusy(true);
    try {
      await desktop()?.clearStorage?.(id);
      setError(null);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setConfirming(null);
      setBusy(false);
      await load();
    }
  };

  if (!available) return null;
  return (
    <>
      <h4 className="settings-group">Space on this computer</h4>
      {error && <FormError>{error}</FormError>}
      {areas?.map((area) => {
        const label = LABELS[area.id] ?? { name: area.id, note: "" };
        const files = area.files === 1 ? "1 file" : `${area.files} files`;
        return (
          <div key={area.id} className="storage-row">
            <p>
              <strong>{label.name}</strong> · {formatBytes(area.bytes)}
              <br />
              <span className="muted">{label.note}</span>
            </p>
            {area.bytes > 0 &&
              (confirming === area.id ? (
                <div className="app-log-actions">
                  <Button variant="danger" disabled={busy} onClick={() => void clear(area.id)}>
                    {busy ? "Deleting…" : `Delete ${files}`}
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button onClick={() => setConfirming(area.id)}>Clear</Button>
              ))}
          </div>
        );
      })}
    </>
  );
}
