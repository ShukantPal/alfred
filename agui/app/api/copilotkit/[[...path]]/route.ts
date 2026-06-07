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

const runtime = new CopilotRuntime({
  agents: { default: alfred },
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
