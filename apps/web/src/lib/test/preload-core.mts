/**
 * Loaded with `--import` before every web test file (scripts/run-tests.mjs),
 * so code that calls `readyCore()` synchronously finds the core loaded.
 * `.mts` because the web package is CommonJS, where top-level await fails.
 */
import { loadTestCore } from "./load-test-core";

await loadTestCore();
