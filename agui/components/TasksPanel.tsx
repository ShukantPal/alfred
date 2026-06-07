"use client";

import { useEffect, useState } from "react";
import { logPollFailure, pollDelayMs } from "@/lib/meetingPoll";
import type { MeetingTask } from "@/lib/mockTasks";

// The action items are generated once near the end of the meeting by the ctl-side
// Talon subagent and stored in agui's tasks buffer. Poll it so the panel fills in
// as soon as they are produced (same reliable request/response transport the live
// notes poll uses).
const POLL_MS = 2_000;

function TaskItem({ task }: { task: MeetingTask }) {
  return (
    <li className="alfred-list-row">
      <div className="alfred-list-row__top">
        <p className="alfred-list-row__title">{task.title}</p>
        <span
          className={`alfred-badge alfred-badge--${task.status === "done" ? "done" : "open"}`}
        >
          {task.status === "done" ? "Done" : "Open"}
        </span>
      </div>
      <p className="alfred-list-row__meta">{task.assignee}</p>
    </li>
  );
}

export function TasksPanel() {
  const [tasks, setTasks] = useState<MeetingTask[]>([]);

  useEffect(() => {
    let stopped = false;
    let pollFailures = 0;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const pollAbort = new AbortController();

    const poll = async () => {
      try {
        const response = await fetch("/api/meeting/tasks", {
          cache: "no-store",
          signal: pollAbort.signal,
        });
        if (response.ok) {
          const data = (await response.json()) as { tasks: MeetingTask[] };
          if (!stopped && Array.isArray(data.tasks)) setTasks(data.tasks);
          pollFailures = 0;
        } else {
          pollFailures += 1;
        }
      } catch (error) {
        pollFailures += 1;
        logPollFailure("tasks", error, pollFailures);
      } finally {
        if (!stopped) {
          pollTimer = setTimeout(poll, pollDelayMs(POLL_MS, pollFailures));
        }
      }
    };

    void poll();

    return () => {
      stopped = true;
      pollAbort.abort();
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, []);

  const openCount = tasks.filter((t) => t.status === "open").length;

  return (
    <section className="alfred-card tasks-panel">
      <div className="alfred-card__header">
        <h2 className="alfred-card__title">Action Items</h2>
        <span className="alfred-badge">{openCount} open</span>
      </div>
      {tasks.length === 0 ? (
        <p className="alfred-list-row__meta">
          Ask Alfred to create action items to populate this list.
        </p>
      ) : (
        <ul className="alfred-card__list">
          {tasks.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
        </ul>
      )}
    </section>
  );
}
