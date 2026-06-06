"use client";

import { useEffect, useState } from "react";
import { AlfredSidePanel } from "@/components/AlfredSidePanel";
import { AppTabBar } from "@/components/AppTabBar";
import { AppWorkspace } from "@/components/AppWorkspace";
import {
  DEFAULT_APP_ID,
  apps,
  documentTitleForApp,
  getAppTab,
} from "@/lib/apps";

// Full-frame layout for the surface Alfred screenshares into the meeting.
// Recall renders this page in a cloud browser and streams it as video.
export default function ScreensharePage() {
  const [activeAppId, setActiveAppId] = useState(DEFAULT_APP_ID);
  const activeApp = getAppTab(activeAppId);

  useEffect(() => {
    document.title = documentTitleForApp(activeApp);
  }, [activeApp]);

  return (
    <div className="screenshare-shell">
      <div className="screenshare-body">
        <AlfredSidePanel />
        <div className="screenshare-main">
          <AppTabBar apps={apps} activeId={activeAppId} onSelect={setActiveAppId} />
          <AppWorkspace app={activeApp} />
        </div>
      </div>
    </div>
  );
}
