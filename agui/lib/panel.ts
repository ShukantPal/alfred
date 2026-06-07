// Live left-panel highlight signals from ctl (mirror of ctl/src/panel.ts).
//
// The screenshare left panel renders "Meeting Notes" and "Action Items" plus a
// row per supported integration. ctl pushes `panel` frames over /ws/notes: a
// `clear` at the start of each addressed turn and `highlight` signals as Alfred
// touches a row. The panel always reflects what Alfred used for the latest prompt.

export type PanelTarget =
  | "notes"
  | "tasks"
  | "redis"
  | "google"
  | "duckduckgo"
  | "docs"
  | "sheets"
  | "slides"
  | "drive";

export type PanelSignalEvent =
  | { op: "clear" }
  | { op: "highlight"; target: PanelTarget };
