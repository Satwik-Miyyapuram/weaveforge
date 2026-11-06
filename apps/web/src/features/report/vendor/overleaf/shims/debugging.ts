/** Stand-in for Overleaf's `@/utils/debugging`. */
export const debugConsole = {
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};
