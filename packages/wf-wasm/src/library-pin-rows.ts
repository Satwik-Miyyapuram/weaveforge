/**
 * Library pin row mapping (Rust `library_pin_rows`). The row is the `library_pins` columns;
 * the pin is camelCase. The repository that reads the table stays in the web app.
 */
import type {
  LibraryPin,
  PinRow,
} from "./bindings.js";

export {
  libraryPinRowToDomain,
} from "../pkg/wf_wasm.js";

export type { LibraryPin, PinRow } from "./bindings.js";

