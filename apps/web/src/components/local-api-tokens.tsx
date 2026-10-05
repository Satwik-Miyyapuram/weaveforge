"use client";

import { useEffect, useState } from "react";
import { formatError } from "@/lib/format-error";
import {
  desktop,
  type DesktopLocalApi,
  type DesktopLocalApiPermission,
} from "@/lib/desktop/desktop-bridge";
import { FormError } from "@/components/form-error";
import { Select } from "@/components/select";
import { DatePicker } from "@/components/date-picker";
import { ConfirmDialog } from "@/components/confirm-dialog";

const MAX_TOKENS = 5;
const EXPIRY_CHOICES = [
  { id: "1d", label: "1 day", days: 1 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "180d", label: "6 months", days: 180 },
  { id: "never", label: "No expiry", days: null },
  { id: "custom", label: "Custom date…", days: null },
] as const;
type ExpiryId = (typeof EXPIRY_CHOICES)[number]["id"];

const PERMISSION_GROUPS: {
  title: string;
  items: { id: DesktopLocalApiPermission; label: string }[];
}[] = [
  {
    title: "Experiments",
    items: [
      { id: "experiments", label: "Log runs, curves and figures (Python SDK)" },
    ],
  },
  {
    title: "Notes REST (Obsidian-style)",
    items: [
      { id: "rest:read", label: "Read and search Notes" },
      { id: "rest:write", label: "Write and delete Notes" },
    ],
  },
  {
    title: "MCP",
    items: [
      { id: "mcp:read", label: "Read and search the workspace" },
      { id: "mcp:suggest", label: "Leave drafts for you to approve" },
    ],
  },
];

export const PERMISSION_LABEL: Record<DesktopLocalApiPermission, string> = {
  experiments: "Experiments",
  "rest:read": "Notes read",
  "rest:write": "Notes write",
  "mcp:read": "MCP read",
  "mcp:suggest": "MCP drafts",
};

function expiryFor(id: ExpiryId, custom: string): string | null | "invalid" {
  if (id === "never") return null;
  if (id === "custom") {
    // End of the chosen day, local time.
    const at = custom ? new Date(`${custom}T23:59:59`).getTime() : NaN;
    return at > Date.now() ? new Date(at).toISOString() : "invalid";
  }
  const days = EXPIRY_CHOICES.find((c) => c.id === id)?.days ?? 30;
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

export function sdkEnvLines(token: string, url: string): string {
  return `export WEAVEFORGE_TOKEN=${token}
export WEAVEFORGE_API_URL=${url}
export WEAVEFORGE_PROJECT="<project name>"`;
}

/** The desktop's local API state, or null off desktop / on an older shell. */
export function useLocalApiState() {
  const [state, setState] = useState<DesktopLocalApi | null>(null);
  useEffect(() => {
    const bridge = desktop();
    if (!bridge) return;
    let live = true;
    void bridge
      .localApiState()
      .then((value) => {
        if (live) setState(value);
      })
      .catch(() => {
        // An older shell without the channel: nothing to show.
      });
    return () => {
      live = false;
    };
  }, []);
  return [state, setState] as const;
}

function when(iso: string | null): string {
  if (!iso) return "Never";
  const at = Date.parse(iso);
  return at <= 0
    ? "—"
    : new Date(at).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/**
 * Create a token. Its value shows here once; only a hash is kept, so it can
 * never be copied again.
 */
export function LocalApiTokenCreate({
  state,
  onChange,
  permissions: fixed,
}: {
  state: DesktopLocalApi;
  onChange: (next: DesktopLocalApi) => void;
  /** Fixes the permissions and hides the picker (the Experiments modal). */
  permissions?: DesktopLocalApiPermission[];
}) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<DesktopLocalApiPermission[]>(
    fixed ?? ["experiments"],
  );
  const [expiry, setExpiry] = useState<ExpiryId>("30d");
  const [customDate, setCustomDate] = useState("");
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(
    null,
  );
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const count = state.tokens?.length ?? 0;

  const create = async () => {
    const bridge = desktop();
    if (!bridge) return;
    const permissions = fixed ?? picked;
    if (!permissions.length) return setError("Pick at least one permission.");
    const expiresAt = expiryFor(expiry, customDate);
    if (expiresAt === "invalid")
      return setError("Pick a custom expiry date in the future.");
    setBusy(true);
    setError(null);
    try {
      let next = state;
      if (!next.enabled) next = await bridge.setLocalApi(true);
      next = await bridge.createLocalApiToken({
        name: name.trim() || undefined,
        permissions,
        expiresAt,
      });
      const made = next.tokens?.find((t) => t.id === next.issued?.id);
      if (next.issued)
        setIssued({ name: made?.name ?? "Token", token: next.issued.token });
      const { issued: _drop, ...rest } = next;
      onChange(rest);
      setName("");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1200);
    } catch (err) {
      setError(`Copying was blocked. (${formatError(err)})`);
    }
  };

  return (
    <div className="local-api-tokens">
      {error && <FormError>{error}</FormError>}
      {issued && (
        <div className="card add-form" role="status">
          <strong>
            {issued.name} created. Copy it now — it will not be shown again.
          </strong>
          <div className="ai-connection-value" style={{ flexWrap: "wrap" }}>
            <code
              style={{ wordBreak: "break-all", minWidth: 0, flex: "1 1 12rem" }}
            >
              {issued.token}
            </code>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void copy("t", issued.token)}
            >
              {copied === "t" ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                void copy("e", sdkEnvLines(issued.token, state.url))
              }
            >
              {copied === "e" ? "Copied" : "Copy env lines"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setIssued(null)}
            >
              Done
            </button>
          </div>
        </div>
      )}
      {!fixed && count < MAX_TOKENS && (
        <fieldset className="token-permissions">
          <legend>Permissions</legend>
          {PERMISSION_GROUPS.map((g) => (
            <div key={g.title}>
              <small className="muted">{g.title}</small>
              {g.items.map((item) => (
                <label key={item.id} className="field-inline">
                  <input
                    type="checkbox"
                    className="themed-check"
                    checked={picked.includes(item.id)}
                    onChange={(e) =>
                      setPicked((prev) =>
                        e.target.checked
                          ? [...prev, item.id]
                          : prev.filter((p) => p !== item.id),
                      )
                    }
                  />
                  {item.label}
                </label>
              ))}
            </div>
          ))}
        </fieldset>
      )}
      {count >= MAX_TOKENS ? (
        <small className="muted">
          Five tokens is the limit. Revoke one in Settings → Access tokens.
        </small>
      ) : (
        <form
          className="field-inline"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input
            type="text"
            aria-label="New token name"
            placeholder="Name, e.g. lab GPU box"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Select
            aria-label="Expires"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value as ExpiryId)}
          >
            {EXPIRY_CHOICES.map((c) => (
              <option key={c.id} value={c.id}>
                Expires: {c.label}
              </option>
            ))}
          </Select>
          {expiry === "custom" && (
            <DatePicker
              aria-label="Custom expiry date"
              value={customDate}
              min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
              onChange={setCustomDate}
            />
          )}
          <button type="submit" className="btn-primary" disabled={busy}>
            Create token
          </button>
        </form>
      )}
      <small className="muted">
        {count}/{MAX_TOKENS} tokens.{" "}
        {fixed &&
          `This token can only do: ${fixed.map((p) => PERMISSION_LABEL[p]).join(", ")}.`}
      </small>
    </div>
  );
}

/** Every token: name, permissions, created, expiry, revoke. Values are never shown. */
export function LocalApiTokenTable({
  state,
  onChange,
}: {
  state: DesktopLocalApi;
  onChange: (next: DesktopLocalApi) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokens = state.tokens ?? [];
  const now = Date.now();

  const [pending, setPending] = useState<{ id: string; name: string } | null>(null);

  const revoke = async (id: string) => {
    const bridge = desktop();
    if (!bridge) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await bridge.revokeLocalApiToken(id));
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  if (!tokens.length) return <p className="muted">No tokens yet.</p>;
  return (
    <>
      {error && <FormError>{error}</FormError>}
      <div style={{ overflowX: "auto", maxWidth: "100%" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Permissions</th>
              <th>Created</th>
              <th>Expires</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => {
              const expired = !!t.expiresAt && Date.parse(t.expiresAt) <= now;
              return (
                <tr key={t.id}>
                  <td>
                    {t.name} <code className="muted">{t.prefix}…</code>
                  </td>
                  <td>
                    {t.permissions.map((p) => PERMISSION_LABEL[p]).join(", ")}
                  </td>
                  <td>{when(t.createdAt)}</td>
                  <td>
                    {expired
                      ? `Expired ${when(t.expiresAt)}`
                      : when(t.expiresAt)}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busy}
                      onClick={() => setPending({ id: t.id, name: t.name })}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pending && (
        <ConfirmDialog
          title={`Revoke "${pending.name}"?`}
          body="Scripts using it stop working."
          confirmLabel="Revoke"
          danger
          busy={busy}
          onConfirm={() => void revoke(pending.id)}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}
