/** Extract a human-readable message from unknown thrown values (incl. Supabase/PostgREST). */
export function formatError(err: unknown): string {
  if (err == null) return "Something went wrong.";

  if (typeof err === "string") {
    const trimmed = err.trim();
    return trimmed && trimmed !== "[object Object]" ? trimmed : "Something went wrong.";
  }

  if (err instanceof Error) {
    const trimmed = err.message?.trim();
    if (trimmed && trimmed !== "[object Object]") return trimmed;
  }

  if (typeof err === "object") {
    const record = err as Record<string, unknown>;
    const message = record.message;
    if (typeof message === "string" && message.trim()) return message.trim();
    if (message != null && typeof message === "object") return formatError(message);

    const code = typeof record.code === "string" ? record.code : null;
    const details = typeof record.details === "string" ? record.details : null;
    const hint = typeof record.hint === "string" ? record.hint : null;
    const errorField = record.error;
    if (errorField != null && errorField !== err) {
      const nested = formatError(errorField);
      if (nested !== "Something went wrong.") return nested;
    }

    const parts: string[] = [];
    if (typeof message === "string" && message.trim()) parts.push(message.trim());
    if (details) parts.push(details);
    if (hint) parts.push(hint);
    if (code) parts.push(`(${code})`);
    if (parts.length > 0) {
      const text = parts.join(" — ");
      if (text.includes("api_tokens") || code === "PGRST205" || code === "42P01") {
        return `${text}. Run supabase db push (migration 0061) if API tokens are not set up yet.`;
      }
      return text;
    }
  }

  try {
    const json = JSON.stringify(err);
    if (json && json !== "{}" && json !== "null") return json;
  } catch {
    /* ignore */
  }

  return "Something went wrong.";
}

/** Parse a fetch response body; empty or invalid JSON becomes a safe object. */
export async function readJsonBody(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { data: parsed };
  } catch {
    return { error: text.slice(0, 300) || `Request failed (${res.status}).` };
  }
}
