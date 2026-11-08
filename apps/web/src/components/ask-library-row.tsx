import { useEffect, useState } from "react";
import type { SearchHit } from "@weaveforge/core";
import {
  activeProviderLabel,
  modelConversation,
  onProviderChange,
} from "@/features/ai-assistant/application/ai-provider-session";
import { askLibrary, type AskResult } from "@/features/search/application/ask-library";
import { Chip, RowButton } from "./controls";

/**
 * "Ask your library" in the palette: the query goes to the user's own model
 * with the passages search found, and the answer comes back citing them.
 * Shown only while a model is configured; without one there is nothing to ask.
 */
export function AskLibraryRow({
  query,
  search,
  onOpen,
}: {
  query: string;
  search: (query: string) => Promise<readonly SearchHit[]>;
  onOpen: (href: string) => void;
}) {
  const [provider, setProvider] = useState(activeProviderLabel);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const question = query.trim();

  useEffect(() => onProviderChange(() => setProvider(activeProviderLabel())), []);
  // A new question clears the old answer.
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [question]);

  if (!provider || !question) return null;

  const ask = async () => {
    const model = modelConversation();
    if (!model) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await askLibrary({ question, search, model }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The model did not answer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="jump-to-ask" aria-live="polite">
      {!result && (
        <RowButton onClick={() => void ask()} disabled={busy}>
          {busy ? `Asking ${provider.label}…` : `Ask your library: “${question}”`}
        </RowButton>
      )}
      {error && <p className="muted">{error}</p>}
      {result && (
        <>
          <p className="jump-to-ask-answer">{result.answer}</p>
          {result.sources.length > 0 && (
            <div className="jump-to-history" role="group" aria-label="Sources">
              {result.sources.map(({ n, hit }) => (
                <Chip key={hit.id} onClick={() => onOpen(hit.href)}>
                  [{n}] {hit.title}
                  {hit.page != null ? `, p. ${hit.page}` : ""}
                </Chip>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
