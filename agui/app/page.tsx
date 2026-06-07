"use client";

import { CopilotSidebar } from "@copilotkit/react-core/v2";
import { AlfredSidePanel } from "@/components/AlfredSidePanel";
import { CopilotKitShell } from "@/components/CopilotKitShell";
import { PanelSignalProvider } from "@/components/PanelSignalProvider";

export default function Page() {
  return (
    <CopilotKitShell>
      <div className="app-shell">
        <PanelSignalProvider>
          <AlfredSidePanel />
        </PanelSignalProvider>

        <main className="main-content">
          <h1>Alfred</h1>
          <p className="subtitle">Live meeting participant — operator console</p>
          <p className="hint">
            The left panel shows live meeting notes and action items. Open the
            chat on the right to ask Alfred about them.
          </p>
        </main>

        <CopilotSidebar />
      </div>
    </CopilotKitShell>
  );
}
