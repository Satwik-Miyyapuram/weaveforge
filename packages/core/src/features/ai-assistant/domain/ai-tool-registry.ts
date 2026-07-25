import type { AiToolName } from "./ai-types.js";

export interface AiToolCallContext {
  sessionId: string;
  userId: string;
  requestId: string;
}

export interface AiToolDefinition<TInput = unknown, TResult = unknown> {
  name: AiToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  handle(input: TInput, context: AiToolCallContext): Promise<TResult>;
}

/** In-app registry shared by the UI and a future MCP transport adapter. */
export class AiToolRegistry {
  private readonly tools = new Map<AiToolName, AiToolDefinition>();

  register<TInput, TResult>(tool: AiToolDefinition<TInput, TResult>): void {
    if (this.tools.has(tool.name)) throw new Error(`AI tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool as AiToolDefinition);
  }

  get(name: AiToolName): AiToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): readonly AiToolDefinition[] {
    return [...this.tools.values()];
  }
}
