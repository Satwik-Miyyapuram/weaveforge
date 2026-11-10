/** Desktop shell Rust function signatures (shell paths, IPC origin). */

/** Desktop shell path naming; the caller passes `path.sep` and `process.platform`. */
export interface ShellPathFns {
  /** The home pointer file: `<home>/.weaveforge/desktop.json`, or `desktop-<variant>.json`. */
  homeConfigPath(home: string, variant: string | null, sep: string): string;
  /** Cursor's and VS Code's user MCP config files for this platform, with each file's servers key. */
  mcpClientConfigs(
    home: string,
    platform: string,
    appData: string | null,
    sep: string,
  ): { file: string; key: "mcpServers" | "servers" }[];
}

/** IPC origin comparison for the desktop IPC guard. */
export interface IpcOriginFns {
  sameOrigin(url: string, origin: string): boolean;
  originOf(url: string): string | null;
}
