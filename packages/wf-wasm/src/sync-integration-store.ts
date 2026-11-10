/**
 * Integration branch rules (Rust `sync::integration_store`): what branch an integration
 * reads back from its stored row, and what branch it writes. The row reads and the
 * upsert stay in `features/sync/infrastructure/postgrest-integrations-store.ts`.
 */
import type {
  BranchReadInput,
  BranchSaveInput,
} from "./bindings.js";

export {
  branchRead,
  branchSave,
} from "../pkg/wf_wasm.js";

export type { BranchReadInput, BranchSaveInput } from "./bindings.js";

