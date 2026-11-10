/**
 * Ask-your-library prompt (Rust `search::ask_library`). The app supplies the
 * sources and the nonce; the search and the model call stay in the app.
 */
import { askPrompt as rawAskPrompt } from "../pkg/wf_wasm.js";
import type { AskPrompt, AskSource } from "./bindings.js";

/** The system and user turns for `question` over `sources`, fenced with `nonce`. */
export function askPrompt(question: string, sources: readonly AskSource[], nonce: string): AskPrompt {
  return rawAskPrompt(question, sources, nonce) as AskPrompt;
}
