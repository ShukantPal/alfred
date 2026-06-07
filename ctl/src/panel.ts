// Live side-panel highlight signals sent to the agui screenshare surface.
//
// The screenshare's left panel renders "Meeting Notes" and "Action Items" plus a
// row per supported integration (Redis, Google Suite + Docs/Sheets/Slides/Drive,
// DuckDuckGo). A `highlight` signal lights up a row when Alfred touches it; a
// `clear` signal (emitted at the start of each addressed turn) resets all rows so
// the panel always reflects what Alfred used for the most recent user prompt.
//
// These are transient, ws-only events (like `agui_run`): there is no catch-up
// buffer because the highlight state is inherently live and reset every turn.

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

/**
 * Map a raw Talon/MCP tool name to the integration row(s) it should highlight.
 * Heuristic by name substring since MCP tool names are namespaced by server
 * (e.g. `company_memory_search`, `mcp_duckduckgo_search_search`, Google Workspace
 * doc/drive tools). A Google Workspace tool always lights the "google" row and,
 * when recognizable, its specific app row too.
 */
export function panelTargetsForTool(toolName: string): PanelTarget[] {
  const name = toolName.toLowerCase();
  const targets = new Set<PanelTarget>();

  if (name.includes("company_memory") || name.includes("memory")) {
    targets.add("redis");
  }
  if (name.includes("duckduckgo") || name.includes("ddg")) {
    targets.add("duckduckgo");
  }

  const isGoogle =
    name.includes("workspace") ||
    name.includes("google") ||
    name.includes("gmail") ||
    name.includes("calendar") ||
    name.includes("doc") ||
    name.includes("sheet") ||
    name.includes("slide") ||
    name.includes("presentation") ||
    name.includes("drive");
  if (isGoogle) {
    targets.add("google");
    if (name.includes("doc")) targets.add("docs");
    if (name.includes("sheet")) targets.add("sheets");
    if (name.includes("slide") || name.includes("presentation")) targets.add("slides");
    if (name.includes("drive")) targets.add("drive");
  }

  return [...targets];
}
