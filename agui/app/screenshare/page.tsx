"use client";

import { useEffect } from "react";
import { AlfredSidePanel } from "@/components/AlfredSidePanel";
import { AppWorkspace } from "@/components/AppWorkspace";
import { ChatProvider } from "@/components/ChatProvider";
import { ChatWatcher } from "@/components/ChatWatcher";
import { MeetingNotesProvider } from "@/components/MeetingNotesProvider";
import { MeetingNotesWatcher } from "@/components/MeetingNotesWatcher";
import { DEFAULT_APP_ID, documentTitleForApp, getAppTab } from "@/lib/apps";

// Full-frame layout for the surface Alfred screenshares into the meeting.
// Recall renders this page in a cloud browser and streams it as video.
export default function ScreensharePage() {
  const activeApp = getAppTab(DEFAULT_APP_ID);

  useEffect(() => {
    document.title = documentTitleForApp(activeApp);
  }, [activeApp]);

  return (
    <MeetingNotesProvider>
      <MeetingNotesWatcher />
      <ChatProvider>
        <ChatWatcher />
        <div className="screenshare-shell">
          <div className="screenshare-body">
            <AlfredSidePanel />
            <div className="screenshare-main">
              <AppWorkspace app={activeApp} />
            </div>
          </div>
        </div>
      </ChatProvider>
    </MeetingNotesProvider>
  );
}
