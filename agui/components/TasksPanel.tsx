"use client";

import { mockTasks, type MeetingTask } from "@/lib/mockTasks";

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
  const tasks = mockTasks;
  const openCount = tasks.filter((t) => t.status === "open").length;

  return (
    <section className="alfred-card tasks-panel">
      <div className="alfred-card__header">
        <h2 className="alfred-card__title">Action Items</h2>
        <span className="alfred-badge">{openCount} open</span>
      </div>
      <ul className="alfred-card__list">
        {tasks.map((task) => (
          <TaskItem key={task.id} task={task} />
        ))}
      </ul>
    </section>
  );
}
