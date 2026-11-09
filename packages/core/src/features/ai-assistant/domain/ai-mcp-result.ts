/** Types for ai-mcp-result. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { UntrustedItem } from "./untrusted-context.js";

export interface McpResultOptions {
  maxItemChars?: number;
  maxResultChars?: number;
  /** Injected so a test can assert an exact fence. */
  nonce?: string;
}

export interface McpResult {
  /** Ready to send as the tool's text content. */
  text: string;
  /** The fence marker, so a transport can repeat it in structured metadata. */
  nonce: string;
  /** Items left out entirely because the result was already full. */
  omitted: number;
  /** Items included but cut short. */
  truncated: number;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface AiMcpResultFns {
  /** Said to the calling agent, outside the fence, about what is inside it. */
  readonly MCP_RESULT_NOTICE: string;
  /** Characters of any single item. Past this, an excerpt stops being an excerpt. */
  readonly MAX_ITEM_CHARS: 8000;
  /** Characters of a whole result. One call must not be able to drain a library. */
  readonly MAX_RESULT_CHARS: 32000;
  /**
 * Turn read-tool output into one bounded, fenced, self-describing result.
 *
 * Items are taken in order until the budget runs out rather than shrunk to fit.
 * A caller ranks its results, and half of each of twenty notes is less use to
 * an agent than the whole of the first five, with an honest count of the rest.
 */
  mcpReadResult(items: readonly UntrustedItem[], options?: McpResultOptions): McpResult;
}
