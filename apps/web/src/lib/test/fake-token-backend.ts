/**
 * A stand-in Supabase for the token routes: auth answers for `user`, and every
 * PostgREST call gets `rest`. Sets the server env the service needs and puts
 * it back afterwards.
 */
import type { TestContext } from "node:test";

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://sb.test",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  SUPABASE_JWT_SECRET: "secret",
} as const;

export function fakeTokenBackend(
  t: TestContext,
  options: { user?: string | null; rest?: () => Response },
): void {
  const saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
  Object.assign(process.env, ENV);
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/auth/v1/user")) {
      return options.user
        ? Response.json({ id: options.user, aud: "authenticated", role: "authenticated" })
        : Response.json({ message: "invalid JWT" }, { status: 401 });
    }
    return options.rest ? options.rest() : Response.json([]);
  });
}

export const RAW_DB_MESSAGE = "permission denied for table api_tokens (internal detail)";

export function dbError(code: string): () => Response {
  return () => Response.json({ code, message: RAW_DB_MESSAGE, details: null, hint: null }, { status: 403 });
}
