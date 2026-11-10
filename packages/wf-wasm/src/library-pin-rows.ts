/**
 * Library pin row mapping (Rust `library_pin_rows`). The row is the `library_pins` columns;
 * the pin is camelCase. The repository that reads the table stays in the web app.
 */
import { libraryPinRowToDomain as rawLibraryPinRowToDomain } from "../pkg/wf_wasm.js";
import type { LibraryPin, PinRow } from "./bindings.js";

export type { LibraryPin, PinRow } from "./bindings.js";

/** A stored pin row as the domain pin. Throws on an unknown resource type. */
export function libraryPinRowToDomain(row: PinRow): LibraryPin {
  return rawLibraryPinRowToDomain(row) as LibraryPin;
}