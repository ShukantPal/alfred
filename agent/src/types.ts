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

export interface CompanyDelegate {
  ask(request: CompanyDelegateRequest): Promise<string>;
  /**
   * Transform a full meeting transcript into structured action items. Runs as a
   * Weave-instrumented subagent node so it shows in the delegation tree.
   */
  extractActionItems(request: ActionItemsRequest): Promise<ActionItem[]>;
  close(): void | Promise<void>;
}
