"use client";

import { AlfredLanding } from "@/components/AlfredLanding";
import { DEFAULT_APP_ID, type AppTab } from "@/lib/apps";

interface AppWorkspaceProps {
  app: AppTab;
}

export function AppWorkspace({ app }: AppWorkspaceProps) {
  const isAlfredHome = app.id === DEFAULT_APP_ID;

  return (
    <main className="app-workspace" data-app={app.id}>
      <section className="app-workspace-card">
        {!isAlfredHome ? (
          <header className="app-workspace-card__header">
            <div>
              <h1 className="app-workspace-card__title">{app.label}</h1>
              <p className="app-workspace-card__description">{app.description}</p>
            </div>
            <span className="alfred-badge">Preview</span>
          </header>
        ) : null}

        <div
          className={
            isAlfredHome
              ? "app-workspace-card__body app-workspace-card__body--landing"
              : "app-workspace-card__body"
          }
        >
          {isAlfredHome ? (
            <AlfredLanding />
          ) : (
            <p className="app-workspace-placeholder">
              {app.label} preview — integration coming soon
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
