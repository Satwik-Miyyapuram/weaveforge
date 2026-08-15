import { formatError } from "@/lib/format-error";


export function safeOverleafError(error: unknown, token?: string): string {
  const raw = formatError(error);
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
