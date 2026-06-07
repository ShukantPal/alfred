"use client";

import { AlfredLanding } from "@/components/AlfredLanding";
import { ChatMode } from "@/components/ChatMode";
import { useMeetingChat } from "@/components/ChatProvider";
import { useVisualAgent } from "@/components/VisualAgentProvider";
import { DEFAULT_APP_ID, type AppTab } from "@/lib/apps";

interface AppWorkspaceProps {
  app: AppTab;
}

export function AppWorkspace({ app }: AppWorkspaceProps) {
  const isAlfredHome = app.id === DEFAULT_APP_ID;
  const { mode: chatMode } = useMeetingChat();
  const { visuals } = useVisualAgent();
  // Flip to chat once there's any conversation or any Alfred-chosen visual.
  const mode = chatMode === "chat" || visuals.length > 0 ? "chat" : "landing";

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

        {isAlfredHome ? (
          // Landing and chat are both mounted so the first delegated question can
          // cross-fade between them. `mode` is the single source of truth.
          <div className="app-workspace-card__body app-workspace-card__body--alfred" data-mode={mode}>
            <div className="workspace-view workspace-view--landing">
              <AlfredLanding />
            </div>
            <div className="workspace-view workspace-view--chat">
              <ChatMode />
            </div>
          </div>
        ) : (
          <div className="app-workspace-card__body">
            <p className="app-workspace-placeholder">
              {app.label} preview — integration coming soon
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
