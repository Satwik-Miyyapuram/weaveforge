"use client";

/**
 * What each tab holds, in the words someone would search for. "Find a setting"
 * matches these, so a search for "dark" lands on Appearance without knowing
 * which group the theme lives in.
 */
const SETTINGS_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  account: ["Profile", "Name", "Email", "Password", "Sign out", "Delete account"],
  org: ["Lab", "Members", "Invite", "Supervisor", "Organisation"],
  appearance: ["Theme", "Dark mode", "Light mode", "Card tint", "Control size", "Surfaces", "Motion", "Font"],
  search: ["Search index", "Semantic search", "Embeddings"],
  paste: ["Paste", "Clipboard", "Paste as markdown"],
  editor: ["Editor", "Spell check", "Line width", "Vim", "Ink", "Page spacing"],
  workspace: ["Workspace folder", "Local files", "Notes folder"],
  ai: ["AI provider", "Model", "API key", "MCP", "Claude"],
  tokens: ["API tokens", "Access token"],
  integrations: ["Zotero", "Overleaf", "GitHub"],
  sync: ["Sync", "Cloud", "Conflicts", "Offline"],
  data: ["Backup", "Export", "Import", "App log"],
  updates: ["Updates", "Version", "Release notes"],
};

export interface SettingsFindHit<T extends string> {
  tab: T;
  word: string;
}

/** Matches on each visible tab's label and keywords; null while the field is empty. */
export function findSettings<T extends string>(
  query: string,
  tabs: readonly { id: T; label: string }[],
): SettingsFindHit<T>[] | null {
  const term = query.trim().toLowerCase();
  if (!term) return null;
  return tabs
    .flatMap((t) =>
      [t.label, ...(SETTINGS_KEYWORDS[t.id] ?? [])]
        .filter((word, i, all) => all.indexOf(word) === i && word.toLowerCase().includes(term))
        .map((word) => ({ tab: t.id, word })),
    )
    .slice(0, 12);
}

/** "Find a setting": the field at the top of the rail, and its matches. */
export function SettingsFind<T extends string>({
  query,
  hits,
  labelOf,
  onQuery,
  onPick,
}: {
  query: string;
  hits: SettingsFindHit<T>[] | null;
  labelOf: ReadonlyMap<T, string>;
  onQuery: (q: string) => void;
  onPick: (tab: T) => void;
}) {
  return (
    <>
      <input
        type="search"
        className="settings-find"
        placeholder="Find a setting"
        aria-label="Find a setting"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      {hits && (
        <div className="settings-find-hits" role="list">
          {hits.length === 0 && <p className="muted settings-find-empty">No setting matches.</p>}
          {hits.map((hit) => (
            <button
              key={`${hit.tab}-${hit.word}`}
              type="button"
              role="listitem"
              className="settings-find-hit"
              onClick={() => onPick(hit.tab)}
            >
              <span>{hit.word}</span>
              <span className="muted">{labelOf.get(hit.tab)}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
