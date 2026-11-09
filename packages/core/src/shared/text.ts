import { rust } from "./rust.js";

/** Words in plain text: runs of non-whitespace. The paper summary cap and report progress both count this way. Rust `count_words`. */
export function countWords(text: string): number {
  return rust().countWords(text);
}
