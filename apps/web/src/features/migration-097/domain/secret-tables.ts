/**
 * Tables that hold secrets (integration tokens, Zotero key, Overleaf token). `secret` is the column
 * that must be set; `owner` scopes the rows to the user (project_integrations goes through projects).
 * `provider` names the service the user must reconnect, so the report never carries the secret itself.
 * The web provider check (infrastructure/postgrest-source.ts) and the move scope (application/move-secrets.ts)
 * both read this list, so they cover the same rows.
 * user_settings has `secret: null`: it holds several secret columns, so its rows are read and named by
 * settingsSecretNames instead of one column count.
 */
export const SECRET_TABLES = [
  { table: "project_integrations", select: "id,projects!inner(user_id)", owner: "projects.user_id", secret: "token", provider: "project integrations" },
  { table: "user_settings", select: "credentials_enc,zotero_api_key,semantic_scholar_key,integrations", owner: "user_id", secret: null, provider: null },
  { table: "overleaf_connections", select: "user_id", owner: "user_id", secret: "token_ciphertext", provider: "overleaf" },
] as const;

function filled(value: unknown): boolean {
  return typeof value === "string" ? value.trim() !== "" : value !== null && value !== undefined;
}

/** True when a value holds any non-blank string, number or boolean at any depth. */
function hasValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasValue);
  if (value !== null && typeof value === "object") return Object.values(value).some(hasValue);
  return filled(value);
}

/**
 * The services a user_settings row (snake_case) holds a secret for, names only. credentials_enc is the server-sealed
 * envelope (0069), which the export cannot open, so it is named as a whole; 0069 clears the plaintext columns once it is
 * written. integrations follows the archive's rule: the whole bag stays off disk, so every provider with a non-blank
 * value, whatever its key or shape, is named for reconnect.
 */
export function settingsSecretNames(row: Record<string, unknown>): string[] {
  const names: string[] = [];
  if (filled(row.credentials_enc)) names.push("sealed credentials");
  if (filled(row.zotero_api_key)) names.push("zotero");
  if (filled(row.semantic_scholar_key)) names.push("semantic scholar");
  const bag = row.integrations;
  if (bag !== null && typeof bag === "object" && !Array.isArray(bag)) {
    for (const [provider, fields] of Object.entries(bag)) {
      if (hasValue(fields)) names.push(provider);
    }
  } else if (hasValue(bag)) {
    // A non-object bag has no provider keys, but it is still stripped from disk: name it as a whole.
    names.push("integrations");
  }
  return [...new Set(names)];
}

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
