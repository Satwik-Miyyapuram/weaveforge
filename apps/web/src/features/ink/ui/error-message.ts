/** The text to show for a caught value: an Error's message, or the value as a string. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
