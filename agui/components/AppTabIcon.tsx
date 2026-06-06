"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import type { AppIcon } from "@/lib/apps";

const icons: Record<Exclude<AppIcon, "alfred">, ReactNode> = {
  slack: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#E01E5A"
        d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
      />
      <path
        fill="#36C5F0"
        d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
      />
      <path
        fill="#2EB67D"
        d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.528 2.528 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"
      />
      <path
        fill="#ECB22E"
        d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.528 2.528 0 0 1 2.52-2.52h6.313A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"
      />
    </svg>
  ),
  docs: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
      />
      <path fill="#A1C2FA" d="M14 2v6h6" />
      <path
        fill="#fff"
        d="M8 13h8v1.5H8V13zm0 3h8V17.5H8V17zm0-6h5V11H8V10z"
      />
    </svg>
  ),
  slides: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#FBBC04"
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
      />
      <path fill="#FDE293" d="M14 2v6h6" />
      <rect fill="#fff" x="8" y="11" width="8" height="5" rx="0.5" />
      <rect fill="#FBBC04" x="9" y="12" width="6" height="0.8" rx="0.2" />
      <rect fill="#FBBC04" x="9" y="13.6" width="4.5" height="0.8" rx="0.2" />
    </svg>
  ),
  sheets: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#0F9D58"
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
      />
      <path fill="#87CEAC" d="M14 2v6h6" />
      <path
        fill="#fff"
        d="M8 10h8v1.5H8V10zm0 2.5h8V14H8v-1.5zm0 2.5h8V17H8v-1.5zM8 17.5h8V19H8v-1.5z"
      />
    </svg>
  ),
};

interface AppTabIconProps {
  icon: AppIcon;
}

export function AppTabIcon({ icon }: AppTabIconProps) {
  if (icon === "alfred") {
    return (
      <span className="app-tab-icon app-tab-icon--alfred">
        <Image src="/alfred-logo.svg" alt="" width={18} height={18} aria-hidden />
      </span>
    );
  }

  return <span className="app-tab-icon">{icons[icon]}</span>;
}
