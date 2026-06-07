import { AbstractAgent, EventType, type BaseEvent, type Message, type RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";
import { getCtlBaseUrl } from "@/lib/meetingConfig";
import type { VisualSpec } from "@/lib/visual";

// The visual-rendering tool name the screenshare's `useRenderTool` binds to.
export const RENDER_CHART_TOOL = "render_chart";

// A headless AG-UI agent that keeps Talon as the only brain. It performs no
// reasoning of its own: it forwards the question to ctl's /api/visual endpoint
// (which runs the Talon `buildVisual` weave.op), then emits AG-UI events that make
// CopilotKit render the resulting VisualSpec via the `render_chart` tool. This is
// the protocol bridge described in AGENTS.md, not a second model.
export class TalonVisualAgent extends AbstractAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>(subscriber => {
      let cancelled = false;

      const emit = (event: BaseEvent) => {
        if (!cancelled) subscriber.next(event);
      };

      void (async () => {
        emit({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId } as BaseEvent);

        const question = lastUserText(input.messages);
        const spec = await fetchVisualSpec(question);

        const messageId = crypto.randomUUID();
        const toolCallId = crypto.randomUUID();
        emit({
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: RENDER_CHART_TOOL,
          parentMessageId: messageId,
        } as BaseEvent);
        emit({
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: JSON.stringify(spec),
        } as BaseEvent);
        emit({ type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent);
        emit({
          type: EventType.TOOL_CALL_RESULT,
          messageId: crypto.randomUUID(),
          toolCallId,
          content: "rendered",
        } as BaseEvent);

        emit({ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId } as BaseEvent);
        if (!cancelled) subscriber.complete();
      })().catch(error => {
        if (cancelled) return;
        subscriber.next({
          type: EventType.RUN_ERROR,
          message: error instanceof Error ? error.message : String(error),
        } as BaseEvent);
        subscriber.error(error);
      });

      return () => {
        cancelled = true;
      };
    });
  }
}

function lastUserText(messages: Message[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && typeof message.content === "string" && message.content.trim()) {
      return message.content.trim();
    }
  }
  return "";
}

async function fetchVisualSpec(question: string): Promise<VisualSpec> {
  if (!question) {
    return { kind: "text", text: "No request was provided to visualize." };
  }
  const baseUrl = getCtlBaseUrl();
  if (!baseUrl) {
    return {
      kind: "text",
      text: "Alfred's control plane is not connected yet, so the data could not be retrieved.",
    };
  }
  try {
    const response = await fetch(`${baseUrl}/api/visual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!response.ok) {
      return { kind: "text", text: `Could not build a visual (ctl returned ${response.status}).` };
    }
    const data = (await response.json()) as { spec?: VisualSpec };
    return data.spec ?? { kind: "text", text: "Alfred returned no visual for that request." };
  } catch (error) {
    return {
      kind: "text",
      text: `Could not reach Alfred's control plane: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
