/**
 * Public API of the org feature module (web half). The app shell and other
 * modules import from here only — never from internal paths.
 */
export { ProfileProvider, useProfile } from "./ui/profile-provider";
export { OrgPanel } from "./ui/org-screen";
export { OrgSwitcher } from "./ui/org-switcher";
export { SupervisionScreen } from "./ui/supervision-screen";
