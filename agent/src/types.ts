export interface CompanyDelegateRequest {
  meetingId: string;
  speaker: {
    id: string;
    displayName: string;
  };
  question: string;
}

export type ActionItemStatus = "open" | "done";

export interface ActionItem {
  title: string;
  assignee: string;
  status: ActionItemStatus;
}

export interface ActionItemsRequest {
  meetingId: string;
  /** The full meeting transcript, formatted as "Speaker: text" lines. */
  transcript: string;
}

export interface ActionItemMatch {
  id: string;
  title: string;
  assignee?: string;
}

export interface ActionItemMatchRequest {
  meetingId: string;
  /** The participant's spoken description of the item to remove. */
  query: string;
  /** The current action items the match should be chosen from. */
  items: ActionItemMatch[];
}

/** The visual representations Alfred can choose from when answering with UI. */
export type VisualKind = "pie" | "bar" | "line" | "table" | "text";

/** A single labelled datapoint shared by pie/bar/line charts. */
export interface VisualPoint {
  label: string;
  value: number;
}

export interface VisualChartSpec {
  kind: "pie" | "bar" | "line";
  title: string;
  /** Optional one-line caption shown under the title. */
  subtitle?: string;
  /** A short unit/format hint, e.g. "$", "%", "k". */
  unit?: string;
  series: VisualPoint[];
}

export interface VisualTableSpec {
  kind: "table";
  title: string;
  subtitle?: string;
  columns: string[];
  /** Each row aligns with `columns`; cells are strings or numbers. */
  rows: Array<Array<string | number>>;
}

export interface VisualTextSpec {
  kind: "text";
  title?: string;
  text: string;
}

/**
 * A self-describing UI spec produced by Alfred. The `kind` field is the
 * discriminant CopilotKit's renderer switches on; Alfred decides which kind
 * best represents the answer.
 */
export type VisualSpec = VisualChartSpec | VisualTableSpec | VisualTextSpec;

export interface VisualRequest {
  meetingId: string;
  /** The participant's free-form request, e.g. "pull up last quarter's finances". */
  question: string;
}

/**
 * Emitted as the delegate calls MCP/tool functions during a delegated operation.
 * ctl maps the tool names to live side-panel integration highlights (Redis,
 * Google Suite, DuckDuckGo). Purely observational — never gates the answer.
 */
export interface ToolUseEvent {
  meetingId: string;
  /** Raw tool/function names the delegate invoked (e.g. "company_memory_search"). */
  tools: string[];
}

export type ToolUseListener = (event: ToolUseEvent) => void;

export interface CompanyDelegate {
  ask(request: CompanyDelegateRequest): Promise<string>;
  /**
   * Transform a full meeting transcript into structured action items. Runs as a
   * Weave-instrumented subagent node so it shows in the delegation tree.
   */
  extractActionItems(request: ActionItemsRequest): Promise<ActionItem[]>;
  /**
   * Resolve which action item a spoken removal request refers to. Runs as a
   * Weave-instrumented subagent node and returns the matching item id, or null
   * when no item is a reasonable match.
   */
  matchActionItemForRemoval(request: ActionItemMatchRequest): Promise<string | null>;
  /**
   * Retrieve the relevant company data for a free-form request and return a
   * self-describing `VisualSpec`, choosing the representation (chart/table/text)
   * that best fits the answer. Runs as a Weave-instrumented subagent node
   * (`alfred.talon.buildVisual`) so it shows in the delegation tree.
   */
  buildVisual(request: VisualRequest): Promise<VisualSpec>;
  /**
   * Subscribe to MCP/tool usage during delegated operations so the caller can
   * surface which integrations (Redis/company-memory, Google Workspace,
   * DuckDuckGo) Alfred actually used. Fires as tools resolve, deduped per
   * operation. Returns an unsubscribe function.
   */
  onToolUse(listener: ToolUseListener): () => void;
  close(): void | Promise<void>;
}
