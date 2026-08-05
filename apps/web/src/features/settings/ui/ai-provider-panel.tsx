"use client";

import { useState } from "react";
import { Select } from "@/components/select";
import { formatError } from "@/lib/format-error";
import {
  activeProviderLabel,
  clearActiveProvider,
  setActiveProvider,
} from "@/features/ai-assistant/application/ai-provider-session";
import {
  ByokModelConversation,
  PROVIDER_PRESETS,
  type ProviderApi,
} from "@/features/ai-assistant/infrastructure/byok-model-conversation";

/**
 * Settings → AI provider.
 *
 * Bring your own key. The key is held in memory for the session and sent only
 * to the endpoint you name — never to WeaveForge's servers, and never stored.
 * That is why it has to be re-entered after a reload: persisting it would mean
 * writing a credential you control into storage we manage.
 *
 * No provider is preferred or preselected. Which model runs is your choice.
 */
export function AiProviderPanel() {
  const [presetId, setPresetId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [api, setApi] = useState<ProviderApi>("openai-chat");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(activeProviderLabel);

  function applyPreset(id: string) {
    setPresetId(id);
    const preset = PROVIDER_PRESETS.find((entry) => entry.id === id);
    if (!preset) return;
    setBaseUrl(preset.baseUrl);
    setApi(preset.api);
    setResult(null);
    setError(null);
  }

  const needsKey = api !== "ollama";
  const ready = baseUrl.trim() && model.trim() && (!needsKey || apiKey.trim());

  function descriptor() {
    const preset = PROVIDER_PRESETS.find((entry) => entry.id === presetId);
    return {
      id: presetId || "custom",
      label: preset?.label ?? "Custom",
      baseUrl: baseUrl.trim(),
      api,
      model: model.trim(),
    };
  }

  /**
   * Test, then keep it.
   *
   * A separate "save" button would let someone enable a provider that has never
   * answered — the first thing they would learn is a failed wiki scan. A reply
   * is the only evidence the endpoint, key, model name, and wire format are all
   * right together, so it is what activation is gated on.
   */
  async function test() {
    setTesting(true);
    setError(null);
    setResult(null);
    try {
      const chosen = descriptor();
      const client = new ByokModelConversation(chosen, apiKey);
      const response = await client.complete({
        messages: [{ role: "user" as const, content: "Reply with the single word: ready" }],
        temperature: 0,
      });
      setResult(response.text.trim().slice(0, 200) || "(empty reply)");
      setActiveProvider(chosen, apiKey);
      setActive(activeProviderLabel());
    } catch (err) {
      setError(formatError(err));
    } finally {
      setTesting(false);
    }
  }

  return (
    <section id="settings-provider" className="card add-form settings-anchor">
      <h3 className="settings-group">AI provider</h3>
      <p className="muted">
        Point WeaveForge at any OpenAI-compatible, Anthropic, or Ollama endpoint. Calls go
        straight from this browser to the provider — your key never reaches our servers.
      </p>

      <div className="field">
        <label htmlFor="provider-preset">Start from</label>
        <Select id="provider-preset" value={presetId} onChange={(e) => applyPreset(e.target.value)}>
          <option value="">Choose a provider…</option>
          {PROVIDER_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </Select>
        <p className="muted jump-to-meta">
          These are starting points, not a whitelist — a self-hosted gateway works just as well.
        </p>
      </div>

      <div className="field">
        <label htmlFor="provider-url">Endpoint</label>
        <input
          id="provider-url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.example.com"
        />
      </div>

      <div className="field">
        <label htmlFor="provider-api">Wire format</label>
        <Select id="provider-api" value={api} onChange={(e) => setApi(e.target.value as ProviderApi)}>
          <option value="openai-chat">OpenAI-compatible</option>
          <option value="anthropic-messages">Anthropic</option>
          <option value="ollama">Ollama</option>
        </Select>
      </div>

      <div className="field">
        <label htmlFor="provider-model">Model</label>
        <input
          id="provider-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="model name as the provider spells it"
        />
      </div>

      {needsKey && (
        <div className="field">
          <label htmlFor="provider-key">API key</label>
          <input
            id="provider-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-…"
            autoComplete="off"
          />
          <p className="muted jump-to-meta">
            Kept in memory for this session only. Re-enter it after a reload — storing it would
            mean putting a credential you control into storage we manage.
          </p>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {result && <p className="muted">Provider replied: “{result}”</p>}

      {active && (
        <p className="muted">
          Active for this session: <strong>{active.label}</strong> · {active.model}. The wiki
          will use it to find concepts; everything else still works without it.
        </p>
      )}

      <div className="screen-actions">
        <button
          className="btn-secondary"
          type="button"
          disabled={testing || !ready}
          onClick={() => void test()}
        >
          {testing ? "Testing…" : active ? "Test and update" : "Test and use"}
        </button>
        {active && (
          <button
            className="btn-ghost"
            type="button"
            disabled={testing}
            onClick={() => {
              clearActiveProvider();
              setActive(null);
              setApiKey("");
              setResult(null);
            }}
          >
            Stop using it
          </button>
        )}
      </div>

      <p className="muted jump-to-meta">
        Some hosted endpoints refuse browser calls outright. That is a CORS decision on their
        side, and it is clearer than quietly routing your key through a server instead.
      </p>
    </section>
  );
}
