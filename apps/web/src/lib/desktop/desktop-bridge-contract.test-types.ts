/**
 * Type-level contract for the 0.9.8 install guard. `install-097-guard.ts` (on
 * feat/098-del-web) reads `migrationReportVerified` from the desktop bridge.
 * Dropping the key from `DesktopBridge` breaks this file under tsgo; there is
 * no runtime assertion, so this file is not picked up by node --test.
 */
import type { DesktopBridge } from "./desktop-bridge";

type GuardBridge = Pick<DesktopBridge, "migrationReportVerified">;
type VerifyReport = NonNullable<GuardBridge["migrationReportVerified"]>;

const verify: VerifyReport = async (folder: string) => folder.length > 0;

export { verify };
