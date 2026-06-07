"use client";

import type { ReactNode } from "react";
import { AppTabIcon } from "@/components/AppTabIcon";
import type { AppIcon } from "@/lib/apps";
import type { PanelTarget } from "@/lib/panel";

/** Side-panel integration rows that get their own icon. */
export type IntegrationId = Extract<
  PanelTarget,
  "redis" | "slack" | "google" | "duckduckgo" | "docs" | "sheets" | "slides" | "drive"
>;

const marks: Partial<Record<IntegrationId, ReactNode>> = {
  redis: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#DC382D"
        d="M12 3C7.03 3 3 4.343 3 6s4.03 3 9 3 9-1.343 9-3-4.03-3-9-3z"
      />
      <path
        fill="#C6302B"
        d="M21 9c0 1.657-4.03 3-9 3S3 10.657 3 9v3c0 1.657 4.03 3 9 3s9-1.343 9-3V9z"
      />
      <path
        fill="#A41E11"
        d="M21 14c0 1.657-4.03 3-9 3s-9-1.343-9-3v3c0 1.657 4.03 3 9 3s9-1.343 9-3v-3z"
      />
    </svg>
  ),
  google: (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  ),
  duckduckgo: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#DE5833" />
      <path
        fill="#fff"
        d="M13.7 5.9c-2-.5-4.1.5-4.9 2.4-.4 1-.4 2 0 2.9-.7.2-1.3.7-1.6 1.4-.5 1.1-.2 2.4.7 3.2V20h2.3v-1.7h2.8V20h2.3v-5.6c.9-.9 1.4-2.1 1.2-3.4-.2-2-1.7-3.6-3.7-4.3z"
      />
      <circle cx="13.4" cy="9.4" r=".8" fill="#DE5833" />
      <path fill="#FDD20A" d="M14.9 11.3l2.6-.7-2 1.8z" />
    </svg>
  ),
};

interface IntegrationIconProps {
  integration: IntegrationId;
}

export function IntegrationIcon({ integration }: IntegrationIconProps) {
  // Google apps reuse the existing app-tab icon set.
  if (
    integration === "slack" ||
    integration === "docs" ||
    integration === "sheets" ||
    integration === "slides" ||
    integration === "drive"
  ) {
    return <AppTabIcon icon={integration as AppIcon} />;
  }

  return <span className="app-tab-icon">{marks[integration]}</span>;
}
