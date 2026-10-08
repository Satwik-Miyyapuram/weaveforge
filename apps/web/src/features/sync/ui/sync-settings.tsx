"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
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
import { DEFAULT_MATTERMOST_SERVER, MattermostSignInButton } from "./mattermost-sign-in-button";

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
    <div className="card settings-block">
      <h3 className="settings-group">Connections — {current.name}</h3>
      <p className="muted">Version this project&rsquo;s work to git and post plan updates. Choose a service to set it up; its token is kept with this project only.</p>
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

  const isMattermost = descriptor.provider === "mattermost";
  // Sign-in vs bot token is a per-reader choice about how the token in the
  // `token` slot was obtained, not a stored field — both end up as one token.
  const modeKey = `wf.mm-signin.${projectId}`;
  const [signIn, setSignIn] = useState(false);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(modeKey);
      // Sign-in is the default; a saved bot token keeps its own mode.
      setSignIn(stored === "1" || (stored === null && !value.token));
    } catch {
      setSignIn(!value.token);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mode is chosen once per project
  }, [modeKey]);
  function chooseSignIn(on: boolean) {
    setSignIn(on);
    try {
      localStorage.setItem(modeKey, on ? "1" : "0");
    } catch {
      /* best effort */
    }
  }

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
            {isMattermost && (
              <div className="integration-enable">
                <span>Sign in with Mattermost instead of a bot token</span>
                <button
                  type="button"
                  className={`toggle${signIn ? " on" : ""}`}
                  role="switch"
                  aria-checked={signIn}
                  onClick={() => chooseSignIn(!signIn)}
                >
                  <span className="knob" />
                </button>
              </div>
            )}
            {isMattermost && signIn && (
              <>
                {value.token && <p className="muted">Signed in to {value.repo || DEFAULT_MATTERMOST_SERVER}.</p>}
                <MattermostSignInButton
                  serverUrl={value.repo ?? ""}
                  label={value.token ? "Sign in again" : "Sign in with Mattermost"}
                  onToken={(token) =>
                    save({ ...value, token, repo: value.repo?.trim() || DEFAULT_MATTERMOST_SERVER }, false)
                  }
                />
              </>
            )}
            {descriptor.fields
              // Sign-in brings its own token and server; only the channel is asked for.
              .filter((field) => !(isMattermost && signIn && field.key !== "branch"))
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
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save connection"}
            </button>
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
        <button
          type="button"
          className={`toggle${opts.sameChannel ? " on" : ""}`}
          role="switch"
          aria-checked={opts.sameChannel}
          aria-label="Use the same channel for everything"
          onClick={() => set({ sameChannel: !opts.sameChannel })}
        >
          <span className="knob" />
        </button>
      </div>
      <div className="integration-enable">
        <span>Events</span>
        <Popover label={onCount === 0 ? "None" : `${onCount} on`} ariaLabel="Events to post" align="right" portal>
          <div className="mm-event-menu">
            {MATTERMOST_EVENTS.map((e) => {
              const on = opts.events[e.id] === true;
              return (
                <button
                  type="button"
                  key={e.id}
                  aria-pressed={on}
                  className={`custom-select-item ms-item${on ? " sel" : ""}`}
                  onClick={() => set({ events: { ...opts.events, [e.id]: !on } })}
                >
                  <span className={`ms-check${on ? " on" : ""}`} aria-hidden />
                  <span>
                    {e.label}
                    <span className="muted mm-event-hint">{e.hint}</span>
                  </span>
                </button>
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
      <button type="button" className="btn-ghost" onClick={() => void test()} disabled={testing}>
        {testing ? "Sending…" : "Send test message"}
      </button>
      {tested && <p className="muted" style={{ margin: 0 }}>{tested}</p>}
    </div>
  );
}
