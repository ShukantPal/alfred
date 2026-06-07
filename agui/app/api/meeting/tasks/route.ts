import { addTask, getTasks, removeTask, removeTaskById, setTasks } from "@/lib/tasksHub";

export const dynamic = "force-dynamic";

// ctl POSTs action-item updates here; the screenshare TasksPanel polls GET.
//   { items: [...] }            -> replace the whole list (end-of-meeting generation)
//   { op: "add", item: {...} }  -> append one item (voice "add" command)
//   { op: "remove", id }        -> remove by exact id (after the delegate resolves a match)
//   { op: "remove", title }     -> remove the best lexical match (fallback)
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const op =
    typeof record.op === "string"
      ? record.op
      : Array.isArray(record.items)
        ? "set"
        : undefined;

  if (op === "set") {
    if (!Array.isArray(record.items)) {
      return Response.json({ error: "items array is required" }, { status: 400 });
    }
    const tasks = setTasks(record.items as { title: string }[]);
    return Response.json({ ok: true, tasks });
  }

  if (op === "add") {
    const source =
      record.item && typeof record.item === "object"
        ? (record.item as { title?: unknown })
        : record;
    const task = addTask(source as { title: string });
    if (!task) {
      return Response.json({ error: "title is required" }, { status: 400 });
    }
    return Response.json({ ok: true, task, tasks: getTasks() });
  }

  if (op === "remove") {
    const id = typeof record.id === "string" ? record.id : "";
    const title = typeof record.title === "string" ? record.title : "";
    if (!id.trim() && !title.trim()) {
      return Response.json({ error: "id or title is required" }, { status: 400 });
    }
    const removed = id.trim() ? removeTaskById(id) : removeTask(title);
    return Response.json({ ok: true, removed: removed ?? null, tasks: getTasks() });
  }

  return Response.json({ error: "unknown op" }, { status: 400 });
}

export async function GET() {
  return Response.json(
    { tasks: getTasks() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
