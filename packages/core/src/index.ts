/**
 * @thesis/core — shared, framework-agnostic domain contracts and types.
 *
 * This package owns the entities, repository interfaces, and use-cases. It has
 * no dependency on React, Next, Supabase, or any I/O library. The web app and
 * the Python SDK both build on these contracts.
 */

export * from "./shared/repository.js";
export * from "./shared/clock.js";
export * from "./shared/dates.js";
export * from "./shared/module.js";
export * from "./config/index.js";
export * from "./features/papers/index.js";
export * from "./features/logbook/index.js";
export * from "./features/report/index.js";
export * from "./features/reading-lists/index.js";
export * from "./features/relations/index.js";
export * from "./features/settings/index.js";
export * from "./features/projects/index.js";
export * from "./features/experiments/index.js";
export * from "./features/plan/index.js";
export * from "./features/org/index.js";
export * from "./features/sharing/index.js";
export * from "./features/tags/index.js";
export * from "./features/integrations/index.js";
export * from "./features/dashboard/index.js";
export * from "./features/vault/index.js";
export * from "./features/library/index.js";
export * from "./features/collab/index.js";
export * from "./features/ai-assistant/index.js";
export * from "./storage/index.js";
export * from "./reader/index.js";
export * from "./workspace/index.js";
export * from "./search/index.js";
export * from "./backend/index.js";
