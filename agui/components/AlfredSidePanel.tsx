"use client";

import { AlfredIcon } from "@/components/AlfredIcon";
import { MeetingNotesPanel } from "@/components/MeetingNotesPanel";
import { TasksPanel } from "@/components/TasksPanel";

export function AlfredSidePanel() {
  return (
    <aside className="alfred-side-panel">
      <header className="alfred-side-panel__header">
        <AlfredIcon />
        <div className="alfred-side-panel__intro">
          <p className="alfred-side-panel__activate">To activate, say</p>
          <h1 className="alfred-side-panel__title">Hey, Alfred</h1>
        </div>
      </header>

      <div className="alfred-side-panel__cards">
        <MeetingNotesPanel />
        <TasksPanel />
      </div>
    </aside>
  );
}
