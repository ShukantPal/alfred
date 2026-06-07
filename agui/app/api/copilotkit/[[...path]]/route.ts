import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";

// Alfred's chat copilot is backed by OpenAI. The "openai/<id>" model string
// resolves to the @ai-sdk/openai provider and reads OPENAI_API_KEY from the
// environment.
const alfred = new BuiltInAgent({
  model: "openai/gpt-4o",
});

const notesAgent = new BuiltInAgent({
  model: "openai/gpt-4o-mini",
  prompt: `You are Alfred's meeting-notes watcher. You receive live transcript context from an ongoing meeting.

Your job: capture the key point of the most recent discussion as a running set of notes by calling the frontend tool addMeetingNote.

Rules:
- Whenever the recent transcript contains a substantive point that is NOT already captured, call addMeetingNote with exactly ONE concise bullet (one sentence, under ~140 characters).
- Prefer capturing a note over staying silent — it is better to record the gist than to miss it.
- Do NOT duplicate or rephrase a bullet already listed in "Meeting notes already captured".
- Only stay silent (call no tool) if the recent transcript is pure filler/greetings, or every point is already captured.
- Never speak to the user; communicate only by calling addMeetingNote.`,
  maxSteps: 3,
  toolChoice: "auto",
});

const runtime = new CopilotRuntime({
  agents: { default: alfred, notes: notesAgent },
});

// Multi-route handler: the CopilotKit client calls `${runtimeUrl}/agent/:id/run`
// and `${runtimeUrl}/info`, so this lives under an optional catch-all segment
// and strips the base path before matching internal routes.
const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const POST = (request: Request) => handler(request);
export const GET = (request: Request) => handler(request);
export const OPTIONS = (request: Request) => handler(request);
