import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { TalonVisualAgent } from "@/lib/talonVisualAgent";

// Alfred's chat copilot is backed by OpenAI. The "openai/<id>" model string
// resolves to the @ai-sdk/openai provider and reads OPENAI_API_KEY from the
// environment.
const alfred = new BuiltInAgent({
  model: "openai/gpt-4o",
});

// The screenshare's generative-UI agent. Talon stays the only brain: this agent
// is a headless protocol bridge that calls ctl -> Talon `buildVisual` and emits a
// `render_chart` tool call for CopilotKit to render. No LLM here.
//
// The cast bridges a types-only duplicate-package issue: @copilotkit/runtime nests
// its own rxjs, so the AbstractAgent's `run()` Observable is a structurally
// identical but nominally distinct type. Runtime behavior is unaffected.
const alfredVisual = new TalonVisualAgent({ agentId: "alfred-visual" });

const runtime = new CopilotRuntime({
  agents: { default: alfred, "alfred-visual": alfredVisual as unknown as BuiltInAgent },
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
