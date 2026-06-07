"use client";

import { MeetingNotesPanel } from "@/components/MeetingNotesPanel";
import { TasksPanel } from "@/components/TasksPanel";

export function AlfredSidePanel() {
  return (
    <aside className="alfred-side-panel">
      <header className="alfred-side-panel__header">
        <h1 className="alfred-side-panel__title">Alfred</h1>
      </header>

      <div className="alfred-side-panel__cards">
        <MeetingNotesPanel />
        <TasksPanel />
      </div>
    </aside>
  );
}
