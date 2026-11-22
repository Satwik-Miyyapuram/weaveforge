/**
 * Tables that hold secrets (integration tokens, Zotero key, Overleaf token). `secret` is the column
 * that must be set; `owner` scopes the rows to the user (project_integrations goes through projects).
 * `provider` names the service the user must reconnect, so the report never carries the secret itself.
 * The web provider check (infrastructure/postgrest-source.ts) and the move scope (application/move-secrets.ts)
 * both read this list, so they cover the same rows.
 */
export const SECRET_TABLES = [
  { table: "project_integrations", select: "id,projects!inner(user_id)", owner: "projects.user_id", secret: "token", provider: "integrations" },
  { table: "user_settings", select: "user_id", owner: "user_id", secret: "zotero_api_key", provider: "zotero" },
  { table: "overleaf_connections", select: "user_id", owner: "user_id", secret: "token_ciphertext", provider: "overleaf" },
] as const;

/**
 * Secret-like columns deliberately NOT counted or moved. The static test in
 * test/secret-tables-coverage.test.ts fails for any table with such a column that is in neither list.
 */
export const EXCLUDED_SECRET_TABLES: readonly { table: string; reason: string }[] = [
  {
    table: "overleaf_workshop_sessions",
    reason:
      "cookie_ciphertext (0155) is a disposable Overleaf session cookie. Sessions are not exported or moved; the user signs in to Overleaf again after the move.",
  },
];
