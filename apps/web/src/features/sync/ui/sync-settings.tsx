"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ConnectionState } from "@/components/connection-state";
import { Popover } from "@/components/popover";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { useProject } from "@/features/projects";
import { emptyIntegration, type Integration } from "../domain/integration";
import { projectSyncDescriptorsForConfig, sharedProviderHint } from "@/integrations/descriptors-resolve";
import type { ProjectSyncDescriptor } from "@/integrations/descriptors-types";
import { gitConnectionReady, mattermostConnectionReady } from "../domain/integration-fields";
import { MATTERMOST_EVENTS, mattermostOptions, type MattermostOptions } from "../domain/mattermost-options";
import { formatError } from "@/lib/format-error";
import { FormError } from "@/components/form-error";
import { MattermostSignInControls, useMattermostSignIn } from "./mattermost-sign-in-controls";
import { loadIntegrations } from "./load-integrations";
import { Button } from "@/components/button";
import { RowButton, Switch, ToggleButton } from "@/components/controls";

export function SyncSettings() {
  const { current } = useProject();
  const descriptors = useMemo(
    () => projectSyncDescriptorsForConfig(getContainer().integrationConfig),
    [],
  );
  const [items, setItems] = useState<Record<string, Integration>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!current || descriptors.length === 0) return;
    setLoading(true);
    const store = getContainer().sync.integrations;
    const providers = [...new Set(descriptors.map((d) => d.provider))];
    const { items: loaded, error } = await loadIntegrations((p) => store.get(current.id, p), providers);
    setItems(loaded);
    setLoadError(error);
    setLoading(false);
  }, [current, descriptors]);

  useEffect(() => { void load(); }, [load]);

  if (!current || descriptors.length === 0) return null;

  return (
    <div className="card settings-block">
      <h3 className="settings-group">Connections — {current.name}</h3>
      <p className="muted">Version this project&rsquo;s work to git and post plan updates. Choose a service to set it up; its token is kept with this project only.</p>
      {loading ? (
        <ScreenLoader status="Loading connections…" compact showTips={false} />
      ) : loadError ? (
        <FormError>{loadError}</FormError>
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

/**
 * The connection fields to ask for. Mattermost sign-in brings its own token,
 * so in that mode only the server URL and channel are asked for.
 */
export function fieldsShown<F extends { key: string }>(fields: readonly F[], mattermostSignIn: boolean): F[] {
  return fields.filter((field) => !mattermostSignIn || field.key !== "token");
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

  const isMattermost = descriptor.provider === "mattermost";
  const [signIn, chooseSignIn] = useMattermostSignIn(projectId, Boolean(value.token));

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

  async function save(next: Integration = value, close = true) {
    setSaving(true);
    setError(null);
    try {
      await getContainer().sync.integrations.save(projectId, next);
      if (next !== value) onChange(next);
      setSaved(true);
      if (close) setOpen(false);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <RowButton className="integration-item" onClick={() => setOpen(true)}>
        <span className="integration-logo" style={{ background: descriptor.color }} />
        <div className="integration-main">
          <strong>{name}</strong>
          <span className="muted">{tagline || descriptor.description}</span>
        </div>
        <ConnectionState connected={connected} />
      </RowButton>

      {open && (
        <Modal title={name} onClose={() => setOpen(false)}>
          <div className="add-form">
            <p className="muted" style={{ marginTop: 0 }}>{descriptor.description}</p>
            {sharedHint && <p className="muted">{sharedHint}</p>}
            <div className="integration-enable">
              <span>Enabled</span>
              <Switch checked={value.enabled} label="Enabled"
                onClick={() => patch({ enabled: !value.enabled })} />
            </div>
            {isMattermost && (
              <MattermostSignInControls
                value={value}
                signIn={signIn}
                onChooseSignIn={chooseSignIn}
                onToken={(token) => save({ ...value, token, repo: value.repo?.trim() }, false)}
              />
            )}
            {fieldsShown(descriptor.fields, isMattermost && signIn)
              .map((field) => (
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
            {descriptor.provider === "mattermost" && (
              <MattermostEventControls value={value} onChange={patch} onError={setError} />
            )}
            {error && <FormError>{error}</FormError>}
            {saved && <p className="muted">Saved.</p>}
            <Button variant="primary" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save connection"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Which events post, and to which channel. Nothing posts until an event is switched on. */
function MattermostEventControls({
  value,
  onChange,
  onError,
}: {
  value: Integration;
  onChange: (p: Partial<Integration>) => void;
  onError: (e: string | null) => void;
}) {
  const opts = mattermostOptions(value);
  const onCount = MATTERMOST_EVENTS.filter((e) => opts.events[e.id] === true).length;
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<string | null>(null);

  function set(next: Partial<MattermostOptions>) {
    onChange({ options: { ...opts, ...next } });
    setTested(null);
  }

  async function test() {
    setTesting(true);
    onError(null);
    setTested(null);
    try {
      const channels = await getContainer().sync.testMattermost(value);
      setTested(
        channels.length === 0
          ? "Nothing is switched on, so nothing was sent."
          : `Test sent to ${channels.length} channel${channels.length === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      onError(formatError(err));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="mm-events">
      <strong>What gets posted</strong>
      <p className="muted" style={{ margin: 0 }}>Nothing is posted until you switch an event on.</p>
      <div className="integration-enable">
        <span>Use the same channel for everything</span>
        <Switch checked={opts.sameChannel} label="Use the same channel for everything"
          onClick={() => set({ sameChannel: !opts.sameChannel })} />
      </div>
      <div className="integration-enable">
        <span>Events</span>
        <Popover label={onCount === 0 ? "None" : `${onCount} on`} ariaLabel="Events to post" align="right" portal>
          <div className="mm-event-menu">
            {MATTERMOST_EVENTS.map((e) => {
              const on = opts.events[e.id] === true;
              return (
                <ToggleButton pressed={on}
                  key={e.id}
                  className={`custom-select-item ms-item${on ? " sel" : ""}`}
                  onClick={() => set({ events: { ...opts.events, [e.id]: !on } })}
                >
                  <span className={`ms-check${on ? " on" : ""}`} aria-hidden />
                  <span>
                    {e.label}
                    <span className="muted mm-event-hint">{e.hint}</span>
                  </span>
                </ToggleButton>
              );
            })}
          </div>
        </Popover>
      </div>
      {!opts.sameChannel &&
        MATTERMOST_EVENTS.filter((e) => opts.events[e.id] === true).map((e) => (
          <div className="field" key={e.id}>
            <label htmlFor={`mm-ch-${e.id}`}>{e.label} channel ID</label>
            <input
              id={`mm-ch-${e.id}`}
              type="text"
              value={opts.channels[e.id] ?? ""}
              onChange={(ev) => set({ channels: { ...opts.channels, [e.id]: ev.target.value } })}
              placeholder="Blank = default channel"
              autoComplete="off"
            />
          </div>
        ))}
      <Button variant="ghost" onClick={() => void test()} disabled={testing}>
        {testing ? "Sending…" : "Send test message"}
      </Button>
      {tested && <p className="muted" style={{ margin: 0 }}>{tested}</p>}
    </div>
  );
}
