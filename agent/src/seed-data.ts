import type { ContextDoc } from "./memory.js";

/**
 * Seed company context (board item 5): Slack/chat + Google Docs across several owners, built
 * around the canonical "owner is on holiday" use case. Multiple onboarding-related docs across
 * owners let one question fan out to several parallel subagents.
 *
 * `url` is what the harness presents on screen (agentAction.presentUrl) when present-mode is on.
 * These are placeholder URLs for the seed demo; real Google Drive supplies real ones later.
 */
export const COMPANY_DOCS: ContextDoc[] = [
  {
    id: "gdoc-onboarding-flow",
    source: "gdoc",
    title: "Onboarding Flow — Q3 Redesign Spec",
    owner: "Priya",
    url: "https://docs.google.com/document/d/onboarding-flow-q3",
    text:
      "The new onboarding cuts the signup steps from 5 to 3. The magic-link email is sent by the " +
      "auth-service, not the web app. Known open issue: the welcome Slack message fires before the " +
      "workspace is provisioned, so new users sometimes see an empty workspace for ~10 seconds.",
  },
  {
    id: "slack-deploy-notes",
    source: "slack",
    title: "#eng-deploys — staging cutover",
    owner: "Priya",
    url: "https://acme.slack.com/archives/C-eng-deploys/p1718000000",
    text:
      "Staging now points at the v2 auth-service. Rollback is `make rollback-auth`. Do not deploy " +
      "the onboarding redesign to prod until the empty-workspace race is fixed (owner: Priya, on PTO until the 14th).",
  },
  {
    id: "gdoc-onboarding-qa",
    source: "gdoc",
    title: "Onboarding Redesign — QA Sign-off Checklist",
    owner: "Sam",
    url: "https://docs.google.com/document/d/onboarding-qa-signoff",
    text:
      "QA pass on the onboarding redesign: all flows green EXCEPT the empty-workspace race condition, " +
      "which is reproducible ~1 in 8 signups. QA will NOT sign off for prod until that race is fixed " +
      "and re-verified. Everything else (3-step flow, magic link, analytics events) is approved.",
  },
  {
    id: "slack-product-launch",
    source: "slack",
    title: "#product — onboarding launch timing",
    owner: "Devon",
    url: "https://acme.slack.com/archives/C-product/p1718100000",
    text:
      "Marketing wants the onboarding redesign live before the conference on the 16th. Eng says it is " +
      "gated on Priya's empty-workspace fix. Decision: hold the prod launch until QA sign-off; do not " +
      "rush it for the conference.",
  },
  {
    id: "project-billing-migration",
    source: "project",
    title: "Billing migration — status",
    owner: "Marco",
    url: "https://acme.atlassian.net/browse/BILL-42",
    text:
      "Stripe migration is 80% done. Remaining: webhook signature verification and the dunning emails. " +
      "Marco owns this; blocked on a finance sign-off scheduled next week.",
  },
  {
    id: "drive-brand-deck",
    source: "drive",
    title: "Company brand deck v4",
    owner: "Lena",
    url: "https://drive.google.com/file/d/brand-deck-v4",
    text:
      "Primary color is deep teal (#0E4C4C), display font is Fraunces, body is Söhne. Logo clear-space " +
      "is 1x the mark height. Do not place the logo on photographic backgrounds without the scrim.",
  },
  {
    id: "gdoc-q3-roadmap",
    source: "gdoc",
    title: "Q3 Roadmap — Engineering",
    owner: "Aisha",
    url: "https://docs.google.com/document/d/q3-roadmap-eng",
    text:
      "Q3 priorities: (1) onboarding redesign, (2) billing/Stripe migration, (3) mobile app beta. " +
      "Onboarding and billing are must-ship; mobile beta is best-effort. Owners: Priya (onboarding), " +
      "Marco (billing), Aisha (mobile).",
  },
];
