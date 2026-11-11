/**
 * The pen's eraser end and barrel button (Rust `ink::pen_pointer`). Takes the
 * primitive pointer fields, because a `PointerEvent`'s getters are not own
 * properties and do not cross into wasm as a struct.
 */
export {
  isPenBarrelPointer,
  isPenEraserPointer,
} from "../pkg/wf_wasm.js";
