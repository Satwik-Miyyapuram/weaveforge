import type {
  BibliographyCredentials,
  IBibliographyIntegration,
  ManageSettingsUseCase,
} from "@weaveforge/core";
import type { IProjectBibliographyCollectionStore } from "@weaveforge/core";
import type { IIntegrationsStore } from "@/features/sync/domain/sync-ports";
import { formatError, readJsonBody } from "@/lib/format-error";

/** A personal access token as the settings API reports it — never the secret. */
export interface ApiTokenRecord {
  id: string;
  name: string;
  tokenPrefix: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

/** An MCP relay token as the settings API reports it — never the secret. */
export interface McpTokenRecord {
  id: string;
  name: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
}

/**
 * The session's bearer token for this deployment's own API routes.
 *
 * Resolved lazily, through the composition root, for the same reason every
 * caller did it at the call site: there is one auth port and the container is
 * the only thing that knows which provider backs it. The dynamic import keeps
 * this file out of a static cycle with `@/bootstrap`, which loads the container
 * that constructs this facade.
 */
async function defaultAccessToken(): Promise<string | null> {
  const { getContainer } = await import("@/bootstrap");
  return getContainer().auth.auth.getAccessToken();
}

/**
 * The route's own message, or the caller's fallback when the body carried none.
 *
 * `formatError` already turns an empty body into "Something went wrong."; this
 * exists so the MCP routes — whose callers say what they were doing — keep the
 * sentence they always showed instead of that generic one.
 */
function errorMessage(payload: Record<string, unknown>, fallback: string): string {
  const reported = formatError(payload.error ?? payload);
  return reported === "Something went wrong." ? fallback : reported;
}

export class SettingsFacade {
  constructor(
    private readonly deps: {
      settings: ManageSettingsUseCase;
      bibliography: IBibliographyIntegration;
      projectBibliography: IProjectBibliographyCollectionStore;
      integrations: IIntegrationsStore;
      /**
       * Overridable so a test can hand in a stub and so the composition root
       * can pass its own auth service. Omitting it falls back to the container's
       * auth facade above.
       */
      accessToken?: () => Promise<string | null>;
    },
  ) {}

  get manageSettings() {
    return this.deps.settings;
  }
  get integrations() {
    return this.deps.integrations;
  }

  /**
   * `credentials` are the values typed into the connection form; without them
   * the provider falls back to whatever is stored.
   */
  listBibliographyCollections(
    credentials?: BibliographyCredentials,
  ) {
    return this.deps.bibliography.listCollections(credentials);
  }

  getProjectCollection(projectId: string) {
    return this.deps.projectBibliography.getCollection(projectId);
  }

  setProjectCollection(projectId: string, collection: string | null) {
    return this.deps.projectBibliography.setCollection(projectId, collection);
  }

  /**
   * Token management, as the settings panels use it.
   *
   * The two panels that display these lists each used to fetch the token, build
   * the `Authorization` header, parse the body and map the failure themselves —
   * the same six lines the app centralised once already. Which token is used,
   * and what a rejected one reads like, is a property of the deployment, not of
   * a screen, so it lives here. Verbs, bodies and the messages a reader sees are
   * unchanged from what the panels did inline.
   */
  private async call<T>(
    path: string,
    init: RequestInit,
    opts: { signIn: string; fallback: string },
  ): Promise<T> {
    const token = await (this.deps.accessToken ?? defaultAccessToken)();
    if (!token) throw new Error(opts.signIn);
    const response = await fetch(path, {
      ...init,
      headers: {
        ...((init.headers ?? {}) as Record<string, string>),
        Authorization: `Bearer ${token}`,
      },
    });
    const payload = await readJsonBody(response);
    if (!response.ok) throw new Error(errorMessage(payload, opts.fallback));
    return payload as T;
  }

  /** Personal access tokens for the Python SDK (Settings → Tokens). */
  get apiTokens() {
    return {
      list: async (): Promise<ApiTokenRecord[]> => {
        const payload = await this.call<{ tokens?: unknown }>("/api/settings/api-tokens", {
          method: "GET",
        }, {
          signIn: "Sign in to manage API tokens.",
          fallback: "Something went wrong.",
        });
        return Array.isArray(payload.tokens) ? (payload.tokens as ApiTokenRecord[]) : [];
      },
      create: (input: { name: string; expiresInDays: number | null }) =>
        this.call<{ record?: ApiTokenRecord; plaintext?: string }>(
          "/api/settings/api-tokens",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
          { signIn: "Sign in to create tokens.", fallback: "Something went wrong." },
        ),
      revoke: (id: string) =>
        this.call<Record<string, unknown>>(
          `/api/settings/api-tokens?id=${encodeURIComponent(id)}`,
          { method: "DELETE" },
          { signIn: "Sign in to revoke tokens.", fallback: "Something went wrong." },
        ),
    };
  }

  /** MCP relay tokens for the Codex plugin connection (Settings → AI access). */
  get mcpTokens() {
    return {
      /**
       * The list is advisory — no session means an empty list rather than a
       * message, because there is nothing the reader could do about it. A
       * deployment without MCP support answers 404, which surfaces as a throw
       * the panel deliberately swallows: the token list is a convenience, and
       * blanking the panel over it would say less than leaving it alone.
       */
      list: async (): Promise<McpTokenRecord[]> => {
        const token = await (this.deps.accessToken ?? defaultAccessToken)();
        if (!token) return [];
        const response = await fetch("/api/settings/mcp-tokens", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = (await response.json().catch(() => ({}))) as { tokens?: McpTokenRecord[]; error?: string };
        if (!response.ok) throw new Error(formatError(payload.error ?? payload));
        return payload.tokens ?? [];
      },
      create: async (): Promise<{ record?: McpTokenRecord; plaintext: string }> => {
        const payload = await this.call<{ record?: McpTokenRecord; plaintext?: string; error?: string }>(
          "/api/settings/mcp-tokens",
          { method: "POST" },
          { signIn: "Sign in to create an MCP token.", fallback: "Could not create MCP token." },
        );
        if (!payload.plaintext) throw new Error("Could not create MCP token.");
        return { record: payload.record, plaintext: payload.plaintext };
      },
      revoke: (id: string) =>
        this.call<Record<string, unknown>>(
          `/api/settings/mcp-tokens?id=${encodeURIComponent(id)}`,
          { method: "DELETE" },
          { signIn: "Sign in to revoke an MCP token.", fallback: "Could not revoke MCP token." },
        ),
    };
  }
}
