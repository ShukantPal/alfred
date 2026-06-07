export type CompanyMemorySource = "gdoc" | "slack" | "project" | "drive";

export interface CompanyMemoryDoc {
  id: string;
  source: CompanyMemorySource;
  title: string;
  owner: string;
  url: string;
  text: string;
}

export interface CompanyMemoryResult extends CompanyMemoryDoc {
  score: number;
}

export const COMPANY_MEMORY_DOCS: CompanyMemoryDoc[] = [
  {
    id: "gdoc-onboarding-flow",
    source: "gdoc",
    title: "Onboarding Flow - Q3 Redesign Spec",
    owner: "Priya",
    url: "https://docs.google.com/document/d/onboarding-flow-q3",
    text:
      "The new onboarding cuts the signup steps from 5 to 3. The magic-link email is sent by the " +
      "auth-service, not the web app. Known open issue: the welcome Slack message fires before the " +
      "workspace is provisioned, so new users sometimes see an empty workspace for about 10 seconds.",
  },
  {
    id: "slack-deploy-notes",
    source: "slack",
    title: "#eng-deploys - staging cutover",
    owner: "Priya",
    url: "https://acme.slack.com/archives/C-eng-deploys/p1718000000",
    text:
      "Staging now points at the v2 auth-service. Rollback is `make rollback-auth`. Do not deploy " +
      "the onboarding redesign to prod until the empty-workspace race is fixed (owner: Priya, on PTO until the 14th).",
  },
  {
    id: "gdoc-onboarding-qa",
    source: "gdoc",
    title: "Onboarding Redesign - QA Sign-off Checklist",
    owner: "Sam",
    url: "https://docs.google.com/document/d/onboarding-qa-signoff",
    text:
      "QA pass on the onboarding redesign: all flows green EXCEPT the empty-workspace race condition, " +
      "which is reproducible about 1 in 8 signups. QA will NOT sign off for prod until that race is fixed " +
      "and re-verified. Everything else (3-step flow, magic link, analytics events) is approved.",
  },
  {
    id: "slack-product-launch",
    source: "slack",
    title: "#product - onboarding launch timing",
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
    title: "Billing migration - status",
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
      "Primary color is deep teal (#0E4C4C), display font is Fraunces, body is Sohne. Logo clear-space " +
      "is 1x the mark height. Do not place the logo on photographic backgrounds without the scrim.",
  },
  {
    id: "sheet-quarterly-finances",
    source: "drive",
    title: "Quarterly Finances - Revenue, Expenses, Net Income",
    owner: "Marco",
    url: "https://docs.google.com/spreadsheets/d/quarterly-finances",
    text:
      "Company quarterly finances tracker (Q1-Q3 2025): total revenue, revenue by category " +
      "(Subscriptions, Services, Marketplace, Other), total expenses, and net income. For the exact " +
      "numbers needed to chart or summarize the quarterly finances, call the company_finance tool, " +
      "which returns the structured per-quarter figures.",
  },
  {
    id: "gdoc-q3-roadmap",
    source: "gdoc",
    title: "Q3 Roadmap - Engineering",
    owner: "Aisha",
    url: "https://docs.google.com/document/d/q3-roadmap-eng",
    text:
      "Q3 priorities: (1) onboarding redesign, (2) billing/Stripe migration, (3) mobile app beta. " +
      "Onboarding and billing are must-ship; mobile beta is best-effort. Owners: Priya (onboarding), " +
      "Marco (billing), Aisha (mobile).",
  },
];

// --- Quarterly finances (seed) ----------------------------------------------
// Structured finance data Alfred can turn into a chart/table. Kept separate from
// the free-text docs above so retrieval can return exact numbers. `getCompanyFinance`
// is the single swap point: replace its body with a Google Sheets / Redis read to
// move off the seed without touching the delegate or MCP surface.

export interface CompanyFinanceLine {
  label: string;
  value: number;
}

export interface CompanyFinanceQuarter {
  quarter: string;
  currency: string;
  /** Revenue split by business line for the quarter. */
  revenueByCategory: CompanyFinanceLine[];
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
}

const COMPANY_FINANCE_SEED: CompanyFinanceQuarter[] = [
  {
    quarter: "Q1 2025",
    currency: "USD",
    revenueByCategory: [
      { label: "Subscriptions", value: 1_280_000 },
      { label: "Services", value: 410_000 },
      { label: "Marketplace", value: 175_000 },
      { label: "Other", value: 60_000 },
    ],
    totalRevenue: 1_925_000,
    totalExpenses: 1_540_000,
    netIncome: 385_000,
  },
  {
    quarter: "Q2 2025",
    currency: "USD",
    revenueByCategory: [
      { label: "Subscriptions", value: 1_460_000 },
      { label: "Services", value: 395_000 },
      { label: "Marketplace", value: 230_000 },
      { label: "Other", value: 75_000 },
    ],
    totalRevenue: 2_160_000,
    totalExpenses: 1_690_000,
    netIncome: 470_000,
  },
  {
    quarter: "Q3 2025",
    currency: "USD",
    revenueByCategory: [
      { label: "Subscriptions", value: 1_720_000 },
      { label: "Services", value: 380_000 },
      { label: "Marketplace", value: 305_000 },
      { label: "Other", value: 95_000 },
    ],
    totalRevenue: 2_500_000,
    totalExpenses: 1_820_000,
    netIncome: 680_000,
  },
];

export const COMPANY_FINANCE: CompanyFinanceQuarter[] = COMPANY_FINANCE_SEED;

/**
 * The company's quarterly finances, most recent last. This is the single swap
 * point for the data source: replace the seed read with a Google Sheets / Redis
 * lookup later without changing the delegate or MCP tool surface.
 */
export function getCompanyFinance(): CompanyFinanceQuarter[] {
  return COMPANY_FINANCE;
}

export function getCompanyMemoryDoc(id: string): CompanyMemoryDoc | undefined {
  return COMPANY_MEMORY_DOCS.find(doc => doc.id === id);
}

export function searchCompanyMemory(query: string, limit = 5): CompanyMemoryResult[] {
  const terms = tokenize(query);
  if (terms.length === 0) return COMPANY_MEMORY_DOCS.slice(0, limit).map(doc => ({ ...doc, score: 0 }));

  return COMPANY_MEMORY_DOCS.map(doc => ({ ...doc, score: scoreDoc(doc, terms) }))
    .filter(doc => doc.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, clampLimit(limit));
}

function scoreDoc(doc: CompanyMemoryDoc, terms: string[]): number {
  const haystack = `${doc.id} ${doc.source} ${doc.title} ${doc.owner} ${doc.text}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) continue;
    score += doc.title.toLowerCase().includes(term) ? 3 : 1;
    score += doc.owner.toLowerCase().includes(term) ? 2 : 0;
    score += doc.text.toLowerCase().includes(term) ? 2 : 0;
  }
  return score;
}

function tokenize(input: string): string[] {
  return Array.from(
    new Set(
      input
        .toLowerCase()
        .split(/[^a-z0-9_-]+/)
        .map(term => term.trim())
        .filter(term => term.length > 2),
    ),
  );
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 5;
  return Math.max(1, Math.min(Math.trunc(limit), 20));
}
