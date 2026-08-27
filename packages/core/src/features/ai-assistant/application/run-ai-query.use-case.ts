import type { AiAccessPolicy } from "../domain/ai-access-policy.js";
import type { AiModelRequest, AiModelResponse, AiSessionGrant, AiAccessSettings } from "../domain/ai-types.js";
import type { IAiSourceReader } from "../domain/ai-reader.js";
import { UNTRUSTED_CONTEXT_RULE, contextNonce, fenceUntrusted } from "../domain/untrusted-context.js";

export interface AiQuerySource {
  resourceType: Parameters<IAiSourceReader["read"]>[0]["resourceType"];
  resourceId: string;
}

export interface RunAiQueryInput {
  question: string;
  sources: readonly AiQuerySource[];
  settings: AiAccessSettings;
  grant: AiSessionGrant;
  encryptionUnlocked: boolean;
  now?: string;
}

export interface RunAiQueryDeps {
  policy: Pick<AiAccessPolicy, "evaluate">;
  reader: IAiSourceReader;
  conversation: {
    complete(request: AiModelRequest): Promise<AiModelResponse>;
  };
}

export class AiQueryDeniedError extends Error {
  constructor(public readonly reason: string) {
    super(`AI query denied: ${reason}`);
    this.name = "AiQueryDeniedError";
  }
}

/** Read-only grounded query flow. It cannot mutate repositories or bypass source policy. */
export class RunAiQueryUseCase {
  constructor(private readonly deps: RunAiQueryDeps) {}

  async execute(input: RunAiQueryInput): Promise<AiModelResponse> {
    const question = input.question.trim();
    if (!question) throw new Error("Question is required");

    const excerpts = [];
    for (const source of input.sources) {
      const decision = this.deps.policy.evaluate({
        settings: input.settings,
        grant: input.grant,
        encryptionUnlocked: input.encryptionUnlocked,
        now: input.now,
        tool: "get_source_excerpt",
        resourceType: source.resourceType,
        resourceId: source.resourceId,
      });
      if (!decision.allowed) throw new AiQueryDeniedError(decision.reason);
      const excerpt = await this.deps.reader.read({ ...source, tool: "get_source_excerpt" });
      if (excerpt) excerpts.push(excerpt);
    }

    // The excerpts are the user's library, not the user: a paper, a note that
    // arrived through a shared folder, a page someone else wrote. Fenced with a
    // nonce and named as data in the system turn, because prose that reaches a
    // model unmarked is prose that can give it instructions.
    const nonce = contextNonce();
    const context = excerpts.length
      ? fenceUntrusted(
          excerpts.map((excerpt) => ({ label: excerpt.source.label, text: excerpt.text })),
          nonce,
        )
      : "(none)";
    return this.deps.conversation.complete({
      messages: [
        {
          role: "system",
          content: [
            "Answer only from the supplied research context. Cite source labels when making claims. If context is insufficient, say so.",
            `The context is delimited by <<context-${nonce}>> and <</context-${nonce}>>.`,
            UNTRUSTED_CONTEXT_RULE,
          ].join(" "),
        },
        { role: "user", content: `Question: ${question}\n\nResearch context:\n${context}` },
      ],
    });
  }
}
