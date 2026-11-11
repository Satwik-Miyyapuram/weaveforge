# provider_descriptor

Rust home: `crates/wf-core/src/ai/provider_descriptor.rs`.

## What it owns

- `ProviderApi`: the wire API names `openai-chat`, `anthropic-messages`, `ollama`.
- `ProviderDescriptor` and `StoredProvider`: the stored shape, camelCase on the wire.
- `parse_stored_provider(raw)`: `None` for invalid JSON, a missing or mistyped field, or an unknown `api`. Extra fields are ignored.

## Where it is called

- wasm export `parseStoredAiProvider` in `crates/wf-wasm/src/ai_provider_descriptor.rs`.
- Wrapper `packages/wf-wasm/src/wrappers-1.ts`, typed as `AiStoredProvider | null`.
- `apps/web/src/features/ai-assistant/application/ai-provider-session.ts` calls `readyCore().parseStoredAiProvider` from `restoreActiveProvider`.

## What stays in TS

Keychain read and write, the in-memory active provider, and listeners. The key is never written to storage by this module.
