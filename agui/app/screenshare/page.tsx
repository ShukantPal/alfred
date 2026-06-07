"use client";

import { useEffect } from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { AlfredSidePanel } from "@/components/AlfredSidePanel";
import { AppWorkspace } from "@/components/AppWorkspace";
import { ChatProvider } from "@/components/ChatProvider";
import { ChatWatcher } from "@/components/ChatWatcher";
import { MeetingNotesProvider } from "@/components/MeetingNotesProvider";
import { PanelSignalProvider } from "@/components/PanelSignalProvider";
import { MeetingNotesWatcher } from "@/components/MeetingNotesWatcher";
import { VisualAgentProvider } from "@/components/VisualAgentProvider";
import { VisualDevConsole } from "@/components/VisualDevConsole";
import { DEFAULT_APP_ID, documentTitleForApp, getAppTab } from "@/lib/apps";

// Full-frame layout for the surface Alfred screenshares into the meeting.
// Recall renders this page in a cloud browser and streams it as video.
//
// CopilotKit is mounted headless (no chat chrome): it is only the AG-UI client for
// the `alfred-visual` agent, whose `render_chart` tool calls surface inside the
// existing ChatMode layout via VisualAgentProvider.
export default function ScreensharePage() {
  const activeApp = getAppTab(DEFAULT_APP_ID);

  useEffect(() => {
    document.title = documentTitleForApp(activeApp);
  }, [activeApp]);

  return (
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <MeetingNotesProvider>
        <MeetingNotesWatcher />
        <ChatProvider>
          <PanelSignalProvider>
            <VisualAgentProvider>
              <ChatWatcher />
              <div className="screenshare-shell">
                <div className="screenshare-body">
                  <AlfredSidePanel />
                  <div className="screenshare-main">
                    <AppWorkspace app={activeApp} />
                  </div>
                </div>
              </div>
              <VisualDevConsole />
            </VisualAgentProvider>
          </PanelSignalProvider>
        </ChatProvider>
      </MeetingNotesProvider>
    </CopilotKit>
  );
}
