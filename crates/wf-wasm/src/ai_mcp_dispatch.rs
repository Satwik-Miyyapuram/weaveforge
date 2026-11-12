//! MCP tool-call planning for JavaScript (wf-core `ai::mcp_dispatch`). The relay keeps the polling,
//! the host calls and the decryption; these exports decide what a call asks for and check evidence.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::ai::mcp_dispatch::{ExcerptDoc, EvidenceRequest, plan_tool_call, paper_evidence};

use super::to_js;

#[wasm_bindgen(typescript_custom_section)]
const MCP_DISPATCH_TS: &str = r"
/** One planned MCP tool call. The host runs the matching call and then, for drafts, checks evidence. */
export type McpPlan =
  | { op: 'searchWorkspace'; query: string; limit?: number }
  | { op: 'getSourceExcerpt'; sourceId: string }
  | { op: 'getWorkspaceOutline' }
  | { op: 'proposeZoteroImport'; title: string; authors: string[]; doi?: string; url?: string; year?: string | number; abstract?: string }
  | { op: 'proposeDraft'; kind: string; tool: string; resourceId?: string; resourceType?: string; expectedRevision?: string; content: string; payload: Record<string, unknown>; evidence?: McpEvidenceRequest };

/** Paper-scoped evidence a draft asked for, before the excerpt is checked. */
export interface McpEvidenceRequest { paperId: string; sourceId: string; quoteExact?: string; quotePrefix?: string; quoteSuffix?: string; page?: number }

/** The excerpt the host resolved for a source; only the fields the check reads. */
export interface McpExcerptDoc { text?: string; source?: { resourceType?: string; resourceId?: string; label?: string; href?: string } }

/** One checked evidence item, as a draft carries it. */
export interface McpEvidence {
  sourceId: string;
  excerpt: string;
  label?: string;
  paperId: string;
  href?: string;
  locus?: { quote: { type: 'TextQuoteSelector'; exact: string; prefix?: string; suffix?: string } };
  page?: number;
}
";

/// [`plan_tool_call`]: what the tool call `tool` with `args` asks for, given the `enabled` names.
///
/// # Errors
///
/// Fails with the refusal message when the tool is not enabled or an argument is refused.
#[wasm_bindgen(js_name = planMcpTool, unchecked_return_type = "McpPlan")]
pub fn plan_mcp_tool_js(
    tool: &str,
    #[wasm_bindgen(unchecked_param_type = "object")] args: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] enabled: JsValue,
) -> Result<JsValue, JsError> {
    let args: serde_json::Value = serde_wasm_bindgen::from_value(args).map_err(js_error)?;
    let enabled: Vec<String> = serde_wasm_bindgen::from_value(enabled).map_err(js_error)?;
    let plan = plan_tool_call(tool, &args, &enabled).map_err(|message| JsError::new(&message))?;
    to_js(&plan).map_err(js_error)
}

/// [`paper_evidence`]: the checked evidence for `request` against the resolved `doc` (or none).
///
/// # Errors
///
/// Fails with the refusal message when the excerpt is missing, the quote is not in it, or the source
/// is not this paper.
#[wasm_bindgen(js_name = mcpPaperEvidence, unchecked_return_type = "McpEvidence[]")]
pub fn mcp_paper_evidence_js(
    #[wasm_bindgen(unchecked_param_type = "McpEvidenceRequest")] request: JsValue,
    #[wasm_bindgen(unchecked_param_type = "McpExcerptDoc | undefined")] doc: JsValue,
) -> Result<JsValue, JsError> {
    let request: EvidenceRequest = serde_wasm_bindgen::from_value(request).map_err(js_error)?;
    let doc: Option<ExcerptDoc> = serde_wasm_bindgen::from_value(doc).map_err(js_error)?;
    let evidence = paper_evidence(&request, doc.as_ref()).map_err(|message| JsError::new(&message))?;
    to_js(&evidence).map_err(js_error)
}

fn js_error(error: serde_wasm_bindgen::Error) -> JsError {
    JsError::new(&error.to_string())
}
