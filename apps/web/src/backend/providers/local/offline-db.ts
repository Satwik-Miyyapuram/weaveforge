import type { SupabaseClient } from "@supabase/supabase-js";
import { NEEDS_ACCOUNT } from "./local-identity";

const refuse = (): never => {
  throw new Error(NEEDS_ACCOUNT);
};

/**
 * The database client of a copy with no account (0.9.7 offline mode).
 *
 * There is no server on the other end, so every query, function call and
 * storage request is refused in words before a request is built. Realtime
 * clean-up calls are no-ops: nothing was ever subscribed.
 */
export function offlineDb(): SupabaseClient {
  return new Proxy({} as SupabaseClient, {
    get(_target, prop) {
      switch (prop) {
        case "from":
        case "rpc":
        case "schema":
        case "channel":
          return refuse;
        case "storage":
        case "functions":
          return { from: refuse, invoke: refuse };
        case "getChannels":
          return () => [];
        case "removeChannel":
        case "removeAllChannels":
          return async () => "ok";
        default:
          return undefined;
      }
    },
  });
}
