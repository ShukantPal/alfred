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
  close(): void | Promise<void>;
}
