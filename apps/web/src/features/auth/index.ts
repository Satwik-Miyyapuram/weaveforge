/**
 * Public API of the auth feature module (web). Other modules and the app shell
 * import from here only — never from internal paths.
 */
export { AuthProvider, useAuth } from "./ui/auth-provider";
export { SupabaseAuthService } from "./infrastructure/supabase-auth";
export type { AuthUser, IAuthService } from "./domain/auth";
