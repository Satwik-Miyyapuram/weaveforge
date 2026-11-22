/**
 * Who owns rows written before anybody signs in.
 *
 * Row-level security is written against `auth.uid()`, so an app with no account
 * would either have to run without policies — every one of them inert — or
 * answer that question with something. It answers with this: a fixed uuid that
 * exists only on this device. Policies then behave identically whether or not
 * an account exists, and turning sync on later is a re-owning of rows rather
 * than a change of security model.
 *
 * Fixed rather than generated, so a reinstall that keeps the data directory
 * finds its own rows again. Version 4 with the `weaveforge` nibbles is a
 * deliberate tell: a row owned by this id never came from a real signup.
 *
 * No database import: this constant is shared by the no-account auth service
 * and by test harnesses, and must not pull a database module in with it.
 */
export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";
