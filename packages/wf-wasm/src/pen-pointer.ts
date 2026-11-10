/**
 * The pen's eraser end and barrel button (Rust `ink::pen_pointer`). Takes the
 * primitive pointer fields, because a `PointerEvent`'s getters are not own
 * properties and do not cross into wasm as a struct.
 */
import {
  isPenBarrelPointer as rawIsPenBarrelPointer,
  isPenEraserPointer as rawIsPenEraserPointer,
} from "../pkg/wf_wasm.js";

/** Whether a pointer event is the pen's eraser end. Touch and mouse never are. */
export function isPenEraserPointer(
  pointerType: string,
  button?: number,
  buttons?: number,
): boolean {
  return rawIsPenEraserPointer(pointerType, button, buttons);
}

/** Whether a pen touched down with its barrel button held. */
export function isPenBarrelPointer(
  pointerType: string,
  button?: number,
  buttons?: number,
): boolean {
  return rawIsPenBarrelPointer(pointerType, button, buttons);
}
