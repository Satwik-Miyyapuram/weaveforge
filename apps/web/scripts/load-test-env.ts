/**
 * Preload for `npm run test:integration` — populates process.env from the
 * gitignored local env files before any test module is evaluated.
 *
 * The integration tests read Supabase URL/key and two disposable test users
 * straight from process.env. Without this preload they always self-skipped,
 * which read as "passing" in CI output. Reuses the E2E loader so the file
 * list and precedence stay in one place.
 */
import { loadLocalDevEnv } from "../e2e/helpers/load-local-dev-env";

loadLocalDevEnv();
