import { getTasks, setTasks } from "@/lib/tasksHub";

export const dynamic = "force-dynamic";

// ctl POSTs generated end-of-meeting action items here; the screenshare TasksPanel
// polls GET to render them live.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const items =
    body && typeof body === "object" && "items" in body
      ? (body as { items?: unknown }).items
      : undefined;
  if (!Array.isArray(items)) {
    return Response.json({ error: "items array is required" }, { status: 400 });
  }

  const tasks = setTasks(items as { title: string }[]);
  return Response.json({ ok: true, tasks });
}

export async function GET() {
  return Response.json(
    { tasks: getTasks() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
