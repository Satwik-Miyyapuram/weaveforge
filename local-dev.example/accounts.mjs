/** Test account layout — emails and roles only (no secrets). */

export const TEST_EMAILS = [
  "a@example.com",
  "b@example.com",
  "c@example.com",
  "d@example.com",
  "e@example.com",
  "f@example.com",
  "g@example.com",
];

export const ACCOUNTS = [
  { email: "a@example.com", fullName: "Test Professor A", role: "professor", lab: "alpha" },
  { email: "b@example.com", fullName: "Test Professor B", role: "professor", lab: "beta" },
  { email: "c@example.com", fullName: "Test PhD C", role: "phd", lab: "beta", supervisor: "b@example.com" },
  { email: "d@example.com", fullName: "Test PhD D", role: "phd", lab: "beta", supervisor: "b@example.com" },
  { email: "e@example.com", fullName: "Test Masters E", role: "masters", lab: "beta", supervisor: "c@example.com" },
  { email: "f@example.com", fullName: "Test Masters F", role: "masters", lab: "beta", supervisor: "c@example.com" },
  { email: "g@example.com", fullName: "Test Standalone G", role: "standalone", lab: null },
];

export const LABS = {
  alpha: { name: "Lab Alpha", owner: "a@example.com" },
  beta: { name: "Lab Beta", owner: "b@example.com" },
};
