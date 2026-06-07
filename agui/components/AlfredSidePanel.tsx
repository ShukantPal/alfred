"use client";

import { IntegrationIcon, type IntegrationId } from "@/components/IntegrationIcon";
import { usePanelSignals } from "@/components/PanelSignalProvider";
import type { PanelTarget } from "@/lib/panel";

// The left panel is now a compact index of what Alfred can surface, not a live
// dump of content. "Meeting Notes" and "Action Items" are single lines that light
// up when Alfred is prompted to show them (the content itself renders in the chat
// window). Below them, one row per supported integration lights up when Alfred
// actually uses it. All highlights reset on the next user prompt (a `clear` signal).
//
// The MeetingNotesPanel / TasksPanel components are intentionally kept in the repo
// (not deleted) — surfacing their content in the chat window is a follow-up PR.

interface ArtifactRow {
  target: Extract<PanelTarget, "notes" | "tasks">;
  label: string;
  glyph: "notes" | "tasks";
}

const artifactRows: ArtifactRow[] = [
  { target: "notes", label: "Meeting Notes", glyph: "notes" },
  { target: "tasks", label: "Action Items", glyph: "tasks" },
];

interface IntegrationRow {
  id: IntegrationId;
  label: string;
}

const integrationRows: IntegrationRow[] = [
  { id: "redis", label: "Redis" },
  { id: "duckduckgo", label: "DuckDuckGo" },
  { id: "docs", label: "Google Docs" },
  { id: "sheets", label: "Google Sheets" },
  { id: "slides", label: "Google Slides" },
  { id: "drive", label: "Google Drive" },
];

function ArtifactGlyph({ glyph }: { glyph: ArtifactRow["glyph"] }) {
  return (
    <span className="panel-row__glyph" aria-hidden>
      {glyph === "notes" ? (
        <svg viewBox="0 0 24 24" fill="none">
          <rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8.5 8h7M8.5 12h7M8.5 16h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M4 7l2.2 2.2L10 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 16l2.2 2.2L10 14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13 8h7M13 17h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

export function AlfredSidePanel() {
  const { highlighted } = usePanelSignals();

  return (
    <aside className="alfred-side-panel">
      <header className="alfred-side-panel__header">
        <h1 className="alfred-side-panel__title">Alfred</h1>
      </header>

      <div className="alfred-side-panel__sections">
        <section className="panel-group">
          <h2 className="panel-group__title">Meeting</h2>
          <ul className="panel-rows">
            {artifactRows.map(row => {
              const active = highlighted.has(row.target);
              return (
                <li
                  key={row.target}
                  className={`panel-row panel-row--artifact${active ? " panel-row--active" : ""}`}
                  data-active={active}
                >
                  <ArtifactGlyph glyph={row.glyph} />
                  <span className="panel-row__label">{row.label}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="panel-group">
          <h2 className="panel-group__title">Integrations</h2>
          <ul className="panel-rows">
            {integrationRows.map(row => {
              const active = highlighted.has(row.id);
              return (
                <li
                  key={row.id}
                  className={`panel-row panel-row--integration${active ? " panel-row--active" : ""}`}
                  data-active={active}
                >
                  <span className="panel-row__icon">
                    <IntegrationIcon integration={row.id} />
                  </span>
                  <span className="panel-row__label">{row.label}</span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </aside>
  );
}
