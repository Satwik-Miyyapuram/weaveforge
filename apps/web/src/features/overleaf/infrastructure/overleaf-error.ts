export function safeOverleafError(error: unknown, token?: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = token ? raw.split(token).join("[redacted]") : raw;
  return redacted.replace(/https?:\/\/[^\s]+/gi, (url) => {
    try {
      const parsed = new URL(url);
      parsed.username = "";
      parsed.password = "";
      return parsed.toString();
    } catch {
      return "[redacted-url]";
    }
  }).slice(0, 500);
}
