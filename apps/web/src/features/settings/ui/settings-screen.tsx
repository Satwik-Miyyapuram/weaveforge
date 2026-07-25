"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { UserSettings, UserIntegrationDescriptor } from "@thesis/core";
import {
  applyUserIntegrationFields,
  getUserIntegrationField,
  isUserIntegrationConnected,
} from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ScreenLoader } from "@/components/thesis-loader";
import { useProject } from "@/features/projects";
import { OrgPanel } from "@/features/org";
import { SyncSettings } from "@/features/sync";
import { AccountInfoPanel } from "./account-info-panel";
import { PrivacyNotice } from "./privacy-notice";
import { DeleteAccountPanel } from "./delete-account-panel";
import { ExportDataPanel } from "./export-data-panel";
import { ApiTokensPanel } from "./api-tokens-panel";
import { GitHubLinkCard } from "./github-link-card";
import { Select } from "@/components/select";
import { userIntegrationsForConfig } from "@/integrations/descriptors";
import { DARK_THEME_OPTIONS, LIGHT_THEME_OPTIONS, CONTROL_SIZE_OPTIONS, DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, sanitizeThemeId, sanitizeControlSize, type ControlSizeId } from "@/lib/theme";
import { persistThemeChange, readLocalAppearance } from "@/lib/theme-persistence";
import { AiAccessPanel } from "./ai-access-panel";

/**
 * Settings screen. Edits the per-user settings record (third-party keys).
 * User integrations are driven by the descriptor registry + deployment config.
 */
export function SettingsScreen() {
  const { current } = useProject();
  const integrationConfig = getContainer().integrationConfig;
  const userIntegrations = useMemo(
    () => userIntegrationsForConfig(integrationConfig),
    [integrationConfig],
  );

  const [settings, setSettings] = useState<UserSettings>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setSaved] = useState(false);
  const [collections, setCollections] = useState<{ key: string; name: string }[]>([]);
  const [projectCollection, setProjectCollection] = useState<string>("");
  const [lightTheme, setLightTheme] = useState<string>(DEFAULT_LIGHT_THEME);
  const [darkTheme, setDarkTheme] = useState<string>(DEFAULT_DARK_THEME);
  const [controlSize, setControlSize] = useState<ControlSizeId>("default");
  const [activeProvider, setActiveProvider] = useState<UserIntegrationDescriptor | null>(null);
  const [aiAccessOpen, setAiAccessOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSettings(await getContainer().settings.manageSettings.get());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const { lightTheme: light, darkTheme: dark, controlSize: size } = readLocalAppearance();
    setLightTheme(light ?? DEFAULT_LIGHT_THEME);
    setDarkTheme(dark ?? DEFAULT_DARK_THEME);
    setControlSize(sanitizeControlSize(size));
  }, [load]);

  function handleLightThemeChange(val: string) {
    const safe = sanitizeThemeId(val, "light");
    setLightTheme(safe);
    persistThemeChange(
      { lightTheme: safe },
      { apply: document.documentElement.dataset.mode !== "dark" },
    );
  }

  function handleDarkThemeChange(val: string) {
    const safe = sanitizeThemeId(val, "dark");
    setDarkTheme(safe);
    persistThemeChange(
      { darkTheme: safe },
      { apply: document.documentElement.dataset.mode === "dark" },
    );
  }

  function handleControlSizeChange(val: string) {
    const safe = sanitizeControlSize(val);
    setControlSize(safe);
    persistThemeChange({ controlSize: safe });
  }

  const loadCollections = useCallback(async () => {
    if (integrationConfig.bibliography === "none") return;
    try {
      const facade = getContainer().settings;
      setCollections(await facade.listBibliographyCollections());
      if (current) setProjectCollection((await facade.getProjectCollection(current.id)) ?? "");
    } catch {
      /* bibliography not configured yet */
    }
  }, [current, integrationConfig.bibliography]);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

  async function saveCollection(key: string) {
    setProjectCollection(key);
    if (current) await getContainer().settings.setProjectCollection(current.id, key || null);
  }

  function patchProviderField(providerId: string, fieldId: string, value: string) {
    setSettings((s) => applyUserIntegrationFields(s, providerId, { [fieldId]: value }));
    setSaved(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await getContainer().settings.manageSettings.save(settings);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const showBibliographyCollection =
    activeProvider?.providerId === integrationConfig.bibliography &&
    integrationConfig.bibliography !== "none";

  return (
    <section className="screen settings-screen">
      <nav className="settings-jump" aria-label="Settings sections">
        <a href="#settings-account">Account</a>
        <a href="#settings-org">Org</a>
        <a href="#settings-appearance">Appearance</a>
        <a href="#settings-ai">AI</a>
        <a href="#settings-tokens">Tokens</a>
        <a href="#settings-integrations">Integrations</a>
        <a href="#settings-sync">Sync</a>
        <a href="#settings-data">Data</a>
      </nav>

      <AccountInfoPanel />

      <div id="settings-org" className="settings-anchor" style={{ marginBottom: "24px" }}>
        <OrgPanel />
      </div>

      <div id="settings-appearance" className="card add-form settings-anchor" style={{ marginBottom: "24px" }}>
        <h3 className="settings-group">Appearance</h3>
        <p className="muted" style={{ margin: "4px 0 12px" }}>Choose your preferred themes for light and dark modes.</p>
        <div className="field-row-equal">
          <div className="field">
            <label htmlFor="lightTheme">Light Theme</label>
            <Select id="lightTheme" value={lightTheme} onChange={(e) => handleLightThemeChange(e.target.value)}>
              {LIGHT_THEME_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </Select>
          </div>
          <div className="field">
            <label htmlFor="darkTheme">Dark Theme</label>
            <Select id="darkTheme" value={darkTheme} onChange={(e) => handleDarkThemeChange(e.target.value)}>
              {DARK_THEME_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </Select>
          </div>
        </div>
        <div className="field" style={{ marginTop: "12px" }}>
          <label htmlFor="controlSize">Button size</label>
          <Select id="controlSize" value={controlSize} onChange={(e) => handleControlSizeChange(e.target.value)}>
            {CONTROL_SIZE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </Select>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            Scales icon buttons and expand toggles (lists, report sections, cards) together.
          </p>
        </div>
      </div>

      {!loading && (
        <div id="settings-ai" className="card add-form settings-anchor" style={{ marginBottom: "24px" }}>
          <h3 className="settings-group">AI & MCP</h3>
          <p className="muted">Control what an AI client such as Codex may read or propose. Access is off by default.</p>
          <button type="button" className="integration-item ai-access-launcher" onClick={() => setAiAccessOpen(true)}>
            <span className="integration-logo ai-access-launcher-icon">✦</span>
            <div className="integration-main"><strong>AI assistant access</strong><span className="muted">Sources, proposals, active sessions, and revocation.</span></div>
            <span className={`status ${settings.aiAccess?.enabled ? "status-done" : "status-not_started"}`}>{settings.aiAccess?.enabled ? "Enabled" : "Disabled"}</span>
          </button>
        </div>
      )}

      {loading ? (
        <ScreenLoader status="Loading settings…" compact />
      ) : (
        <>
          <ApiTokensPanel />

          {userIntegrations.length > 0 ? (
            <div id="settings-integrations" className="card add-form settings-anchor">
              <h3 className="settings-group">Integrations</h3>
              <p className="muted">Metadata sources for your library. Tap one to configure it.</p>
              <div className="integration-list">
                {userIntegrations.map((d) => {
                  const connected = isUserIntegrationConnected(
                    settings,
                    d.providerId,
                    d.fields.map((f) => f.id),
                  );
                  return (
                    <button
                      key={d.providerId}
                      type="button"
                      className="integration-item"
                      onClick={() => setActiveProvider(d)}
                    >
                      <span className="integration-logo" style={{ background: d.color }} />
                      <div className="integration-main">
                        <strong>{d.title}</strong>
                        <span className="muted">{d.description}</span>
                      </div>
                      <span className={`status ${connected ? "status-done" : "status-not_started"}`}>
                        {connected ? "Connected" : "Not set"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </>
      )}

      {activeProvider && (
        <Modal title={activeProvider.title} onClose={() => setActiveProvider(null)}>
          <form
            className="add-form"
            onSubmit={(e) => { void submit(e).then(() => setActiveProvider(null)); }}
          >
            <p className="muted" style={{ marginTop: 0 }}>{activeProvider.description}</p>
            {activeProvider.fields.map((field) => (
              <div className="field" key={field.id}>
                <label htmlFor={`${activeProvider.providerId}-${field.id}`}>{field.label}</label>
                <input
                  id={`${activeProvider.providerId}-${field.id}`}
                  type={field.type}
                  value={getUserIntegrationField(settings, activeProvider.providerId, field.id) ?? ""}
                  onChange={(e) => patchProviderField(activeProvider.providerId, field.id, e.target.value)}
                  placeholder={field.placeholder}
                  autoComplete="off"
                />
              </div>
            ))}
            {showBibliographyCollection && current && (
              <div className="field">
                <label htmlFor="bib-col">Collection — {current.name}</label>
                <Select
                  id="bib-col"
                  value={projectCollection}
                  onChange={(e) => void saveCollection(e.target.value)}
                >
                  <option value="">— whole library —</option>
                  {collections.map((c) => (
                    <option key={c.key} value={c.key}>{c.name}</option>
                  ))}
                </Select>
                {collections.length === 0 && (
                  <span className="muted">Save credentials, then reopen to pick a collection.</span>
                )}
              </div>
            )}
            {error && <p className="error">{error}</p>}
            <button className="btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save connection"}
            </button>
          </form>
        </Modal>
      )}

      {aiAccessOpen && (
        <Modal title="AI & MCP access" onClose={() => !busy && setAiAccessOpen(false)}>
          <form className="add-form ai-access-modal" onSubmit={(event) => { void submit(event).then(() => setAiAccessOpen(false)); }}>
            <AiAccessPanel settings={settings} onChange={setSettings} />
            {error && <p className="error">{error}</p>}
            <div className="ai-access-modal-actions"><button type="button" className="btn-secondary" onClick={() => setAiAccessOpen(false)}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save AI access"}</button></div>
          </form>
        </Modal>
      )}

      {!loading && (
        <div id="settings-sync" className="settings-anchor">
          <SyncSettings />
        </div>
      )}

      <div style={{ marginTop: "24px" }}>
        <ExportDataPanel />
        <PrivacyNotice />
        <GitHubLinkCard />
        <DeleteAccountPanel />
      </div>
    </section>
  );
}
