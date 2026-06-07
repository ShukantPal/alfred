"use client";

import { CopilotSidebar } from "@copilotkit/react-core/v2";
import { AlfredSidePanel } from "@/components/AlfredSidePanel";
import { ClientOnly } from "@/components/ClientOnly";
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
            The left panel shows what Alfred can surface. Ask Alfred in the meeting
            to show notes, action items, or company context in the shared chat.
          </p>
        </main>

        <ClientOnly>
          <CopilotSidebar />
        </ClientOnly>
      </div>
    </CopilotKitShell>
  );
}
