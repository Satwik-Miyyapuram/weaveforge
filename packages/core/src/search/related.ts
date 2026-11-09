/** Types for related. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

/**
 * "Related to this" — a three-arm cascade, because no single retrieval strategy
 * is right across the range of workspaces this has to serve.
 *
 * On a densely linked workspace, graph expansion finds things a keyword search
 * never would. On a sparse one — which is most workspaces early on — PPR
 * degrades to "here is the seed and nothing else", and lexical similarity is
 * genuinely the better answer. The arm used is reported so the UI can say why,
 * rather than silently returning a worse result.
 */

export type RelatedArm = "graph" | "lexical" | "semantic" | "tags" | "none";

export interface RelatedResult {
  id: string;
  score: number;
  /** The method that ranked it first — what the list is headed with. */
  arm: RelatedArm;
  /**
   * Every method that found it, strongest first, when more than one ran. A
   * paper both linked from the seed and close to it in meaning says so.
   */
  arms?: readonly RelatedArm[];
  /**
   * Cosine similarity to the seed, 0–1, when the meaning arm found it. The
   * fused `score` is a rank blend and means nothing as a number; this does.
   */
  similarity?: number;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface RelatedFns {
  /** Below this the seed has too little neighbourhood for a walk to say anything. */
  readonly MIN_SEED_DEGREE_FOR_PPR: 3;
  /** Human-readable reason, so a thin result set is explained rather than puzzling. */
  explainArm(arm: RelatedArm): string;
}
