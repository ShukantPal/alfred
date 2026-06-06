export type AppIcon = "alfred" | "slack" | "docs" | "slides" | "sheets";

export interface AppTab {
  id: string;
  label: string;
  description: string;
  icon: AppIcon;
  /** Future: URL or embed target once integrations are wired. */
  url?: string;
}

export const DEFAULT_APP_ID = "alfred";

export const apps: AppTab[] = [
  {
    id: "alfred",
    label: "Alfred",
    description: "Your live meeting copilot — listening, taking notes, and tracking action items.",
    icon: "alfred",
  },
  {
    id: "slack",
    label: "Slack",
    description: "Slack — team messages and meeting channels.",
    icon: "slack",
    url: "https://slack.com",
  },
  {
    id: "sheets",
    label: "Google Sheets",
    description: "Google Sheets — spreadsheets and trackers.",
    icon: "sheets",
    url: "https://sheets.google.com",
  },
  {
    id: "slides",
    label: "Google Slides",
    description: "Google Slides — presentations and deck reviews.",
    icon: "slides",
    url: "https://slides.google.com",
  },
  {
    id: "docs",
    label: "Google Docs",
    description: "Google Docs — meeting notes and shared documents.",
    icon: "docs",
    url: "https://docs.google.com",
  },
];

export function getAppTab(id: string): AppTab {
  return apps.find((app) => app.id === id) ?? apps[0];
}

export function documentTitleForApp(app: AppTab): string {
  if (app.id === DEFAULT_APP_ID) return "Alfred";
  return `${app.label} — Alfred`;
}
