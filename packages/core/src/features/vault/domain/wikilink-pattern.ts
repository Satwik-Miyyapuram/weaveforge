/**
 * One `[[...]]` on one line; group 1 is the inside. A new regex per call: a
 * shared `/g` regex carries `lastIndex` from one caller into the next.
 */
export function wikilinkPattern(): RegExp {
  return /\[\[([^\[\]\n]+?)\]\]/g;
}