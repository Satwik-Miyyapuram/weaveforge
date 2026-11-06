/**
 * Stand-in for lodash's `isEqual`, which the graphics widget uses to compare
 * two FigureData values. Both are plain data, so their JSON is enough.
 */
export function isEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
