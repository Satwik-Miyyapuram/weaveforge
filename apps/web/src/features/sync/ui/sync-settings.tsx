"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { useProject } from "@/features/projects";
import { emptyIntegration, type Integration } from "../domain/integration";
import { projectSyncDescriptorsForConfig, sharedProviderHint } from "@/integrations/descriptors-resolve";
import type { ProjectSyncDescriptor } from "@/integrations/descriptors-types";
import { gitConnectionReady, mattermostConnectionReady } from "../domain/integration-fields";
import { formatError } from "@/lib/format-error";

export function SyncSettings() {
  const { current } = useProject();
  const descriptors = useMemo(
    () => projectSyncDescriptorsForConfig(getContainer().integrationConfig),
    [],
  );
  const [items, setItems] = useState<Record<string, Integration>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!current || descriptors.length === 0) return;
    setLoading(true);
    try {
      const store = getContainer().sync.integrations;
      const providers = [...new Set(descriptors.map((d) => d.provider))];
      const loaded = await Promise.all(providers.map((p) => store.get(current.id, p)));
      const byProvider = Object.fromEntries(
        providers.map((p, i) => [p, loaded[i] ?? emptyIntegration(p)]),
      ) as Record<string, Integration>;
      setItems(byProvider);
    } finally {
      setLoading(false);
    }
  }, [current, descriptors]);

  useEffect(() => { void load(); }, [load]);

  if (!current || descriptors.length === 0) return null;

  return (
    <div className="card add-form">
      <h3 className="settings-group">Connections — {current.name}</h3>
      <p className="muted">Version this project&rsquo;s work to git and post plan updates. Tap a service to configure it; tokens are stored per project (RLS-isolated).</p>
      {loading ? (
        <ScreenLoader status="Loading connections…" compact showTips={false} />
      ) : (
        <div className="integration-list">
          {descriptors.map((d) => (
            <IntegrationRow
              key={d.id}
              descriptor={d}
              allDescriptors={descriptors}
              value={items[d.provider] ?? emptyIntegration(d.provider)}
              projectId={current.id}
              onChange={(v) => setItems((s) => ({ ...s, [d.provider]: v }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function IntegrationRow({
  descriptor,
  allDescriptors,
  value,
  projectId,
  onChange,
}: {
  descriptor: ProjectSyncDescriptor;
  allDescriptors: readonly ProjectSyncDescriptor[];
  value: Integration;
  projectId: string;
  onChange: (v: Integration) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected =
    descriptor.provider === "mattermost"
      ? mattermostConnectionReady(value)
      : gitConnectionReady(value);
  const parts = descriptor.title.split("—").map((s) => s.trim());
  const name = parts[0] ?? descriptor.title;
  const tagline = parts[1];
  const sharedHint = sharedProviderHint(descriptor, allDescriptors);

  function patch(p: Partial<Integration>) {
    onChange({ ...value, ...p });
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await getContainer().sync.integrations.save(projectId, value);
      setSaved(true);
      setOpen(false);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button type="button" className="integration-item" onClick={() => setOpen(true)}>
        <span className="integration-logo" style={{ background: descriptor.color }} />
        <div className="integration-main">
          <strong>{name}</strong>
          <span className="muted">{tagline || descriptor.description}</span>
        </div>
        <span className={`status ${connected ? "status-done" : "status-not_started"}`}>
          {connected ? "Connected" : "Not set"}
        </span>
      </button>

      {open && (
        <Modal title={name} onClose={() => setOpen(false)}>
          <div className="add-form">
            <p className="muted" style={{ marginTop: 0 }}>{descriptor.description}</p>
            {sharedHint && <p className="muted">{sharedHint}</p>}
            <div className="integration-enable">
              <span>Enabled</span>
              <button
                type="button"
                className={`toggle${value.enabled ? " on" : ""}`}
                role="switch"
                aria-checked={value.enabled}
                onClick={() => patch({ enabled: !value.enabled })}
              >
                <span className="knob" />
              </button>
            </div>
            {descriptor.fields.map((field) => (
              <div className="field" key={field.key}>
                <label>{field.label}</label>
                <input
                  type={field.type}
                  value={value[field.key] ?? ""}
                  onChange={(e) => patch({ [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                  autoComplete="off"
                />
              </div>
            ))}
            {error && <p className="error">{error}</p>}
            {saved && <p className="muted">Saved.</p>}
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save connection"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
