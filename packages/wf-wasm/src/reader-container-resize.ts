/**
 * Container resize decision (Rust `reader_container_resize`). Keeps the rule of
 * apps/web/src/features/reader/ui/pdf-reader/container-resize.ts.
 */
import type {
  BoxSize,
} from "./bindings.js";

export {
  containerResize,
} from "../pkg/wf_wasm.js";

export type { BoxSize } from "./bindings.js";

/** `ignore` a same-size or hidden measure, `now` to refit at once, `settle` to wait for the size. (Narrowing: pure TS literal union, Rust returns &str.) */
export type ContainerResizeAction = "ignore" | "now" | "settle";

