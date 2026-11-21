/**
 * Public API of the auth feature module (web). Other modules and the app shell
 * import from here only — never from internal paths.
 */
export { AuthContext, useAuth } from "./ui/auth-provider";
