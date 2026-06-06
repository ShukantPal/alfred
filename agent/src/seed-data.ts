import type { ContextDoc } from "./memory.js";

/**
 * Seed company context that demonstrates the "owner is on holiday" use case.
 * Imported by both seed.ts (loads into Redis) and smoke.ts (in-process demo).
 */
export const COMPANY_DOCS: ContextDoc[] = [
  {
    id: "gdoc-onboarding-flow",
    source: "gdoc",
    title: "Onboarding Flow — Q3 Redesign Spec",
    owner: "Priya",
    text:
      "The new onboarding cuts the signup steps from 5 to 3. The magic-link email is sent by the " +
      "auth-service, not the web app. Known open issue: the welcome Slack message fires before the " +
      "workspace is provisioned, so new users sometimes see an empty workspace for ~10 seconds.",
  },
  {
    id: "slack-deploy-notes",
    source: "slack",
    title: "#eng-deploys thread — staging cutover",
    owner: "Priya",
    text:
      "Staging now points at the v2 auth-service. Rollback is `make rollback-auth`. Do not deploy " +
      "the onboarding redesign to prod until the empty-workspace race is fixed (owner: Priya, on PTO until the 14th).",
  },
  {
    id: "project-billing-migration",
    source: "project",
    title: "Billing migration — status",
    owner: "Marco",
    text:
      "Stripe migration is 80% done. Remaining: webhook signature verification and the dunning emails. " +
      "Marco owns this; blocked on a finance sign-off scheduled next week.",
  },
  {
    id: "drive-brand-deck",
    source: "drive",
    title: "Company brand deck v4",
    owner: "Lena",
    text:
      "Primary color is deep teal (#0E4C4C), display font is Fraunces, body is Söhne. Logo clear-space " +
      "is 1x the mark height. Do not place the logo on photographic backgrounds without the scrim.",
  },
];
