"use client";

import { AppTabIcon } from "@/components/AppTabIcon";
import type { AppTab } from "@/lib/apps";

interface AppTabBarProps {
  apps: AppTab[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function AppTabBar({ apps, activeId, onSelect }: AppTabBarProps) {
  return (
    <nav className="browser-tab-bar" aria-label="Open apps">
      <ul className="browser-tab-list">
        {apps.map((app) => (
          <li key={app.id}>
            <button
              type="button"
              className={`browser-tab${app.id === activeId ? " browser-tab--active" : ""}`}
              aria-selected={app.id === activeId}
              aria-current={app.id === activeId ? "page" : undefined}
              onClick={() => onSelect(app.id)}
            >
              <AppTabIcon icon={app.icon} />
              <span className="browser-tab__label">{app.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
