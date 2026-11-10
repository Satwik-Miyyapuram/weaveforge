/**
 * MCP client config text for each AI client (Rust `mcp_client_config`),
 * re-exported from index.ts.
 */
import type {
  McpLaunchLine,
} from "./bindings.js";

export {
  claudeCodeCommands,
  codexToml,
  geminiInstall,
  mcpServersJson,
  vscodeJson,
} from "../pkg/wf_wasm.js";

export type { McpLaunchLine } from "./bindings.js";

