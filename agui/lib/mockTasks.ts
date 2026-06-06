export type TaskStatus = "open" | "done";

export interface MeetingTask {
  id: string;
  title: string;
  assignee: string;
  status: TaskStatus;
}

// Mock task list. This will be replaced by a live feed from the ctl control
// plane as Alfred extracts action items from the meeting.
export const mockTasks: MeetingTask[] = [
  {
    id: "t_005",
    title: "Ship OAuth patch before sprint end",
    assignee: "Priya",
    status: "open",
  },
  {
    id: "t_004",
    title: "Send client timezone summary to Marcus",
    assignee: "Marcus",
    status: "open",
  },
  {
    id: "t_003",
    title: "Update sprint board with remaining 14 points",
    assignee: "Priya",
    status: "open",
  },
  {
    id: "t_002",
    title: "Confirm deployment runbook with Sam",
    assignee: "Dana",
    status: "open",
  },
  {
    id: "t_001",
    title: "Schedule Q3 auth rewrite planning session",
    assignee: "Dana",
    status: "done",
  },
];
