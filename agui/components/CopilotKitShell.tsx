"use client";

import { CopilotKit } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { MeetingNotesProvider } from "@/components/MeetingNotesProvider";
import { MeetingNotesWatcher } from "@/components/MeetingNotesWatcher";

export function CopilotKitShell({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <MeetingNotesProvider>
        <MeetingNotesWatcher />
        {children}
      </MeetingNotesProvider>
    </CopilotKit>
  );
}
