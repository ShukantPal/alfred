import { Code, ConnectError, createPromiseClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { events, gateway, gatewayConnect, manifests, models } from "@impalasys/talon-client";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as weave from "weave";
import {
  authorizationHeader,
  mintJwt,
  start as startTalon,
  type TalonConfig,
  type TalonServer,
} from "@impalasys/talon-server";
import { initWeave } from "./observability";
import type { CompanyDelegate, CompanyDelegateRequest } from "./types";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const WANDB_INFERENCE_BASE_URL = "https://api.inference.wandb.ai/v1";
const DEFAULT_MEMORY_MCP_SCRIPT = fileURLToPath(new URL("./memory-mcp.ts", import.meta.url));

type McpTransport = "http" | "stdio";

export interface TalonCompanyDelegateOptions {
  apiKey?: string;
  namespace: string;
  agentName: string;
  providerName: string;
  providerBaseUrl: string;
  model: string;
  dataDir: string;
  workspaceDir: string;
  jwtSecret: string;
  jwtTtlSeconds: number;
  weaveProject: string;
  mcpServerName: string;
  mcpTransport: McpTransport;
  mcpTarget: string;
  mcpArgs: string[];
  mcpHeaders: Record<string, string>;
  timeoutMs: number;
}

export interface TalonRuntimeInfo {
  grpcEndpoint: string;
  uiEndpoint: string;
  namespace: string;
  agentName: string;
  dataDir: string;
  workspaceDir: string;
  mcpServerName?: string;
  mcpTransport?: McpTransport;
  mcpTarget?: string;
  mcpArgs?: string[];
}

export class TalonCompanyDelegate implements CompanyDelegate {
  private readonly sessionsByMeeting = new Map<string, string>();
  private readonly startRuntimeOp: () => Promise<TalonRuntime>;
  private readonly bootstrapOp: (runtime: TalonRuntime) => Promise<void>;
  private readonly askOp: (request: CompanyDelegateRequest) => Promise<string>;
  private weaveInitPromise?: Promise<boolean>;
  private initPromise?: Promise<TalonRuntime>;

  constructor(private readonly options: TalonCompanyDelegateOptions) {
    this.startRuntimeOp = weave.op(this, this.startRuntime, {
      name: "alfred.talon.start",
      summarize: runtime => ({
        grpcEndpoint: runtime.server.grpcEndpoint,
        namespace: this.options.namespace,
        agentName: this.options.agentName,
        dataDir: this.options.dataDir,
      }),
    });
    this.bootstrapOp = weave.op(this, this.bootstrapRuntime, {
      name: "alfred.talon.bootstrap",
      summarize: () => ({
        namespace: this.options.namespace,
        agentName: this.options.agentName,
        mcpServerName: this.options.mcpServerName,
        mcpTransport: this.options.mcpTransport,
      }),
    });
    this.askOp = weave.op(this, this.askRuntime, {
      name: "alfred.talon.ask",
      summarize: answer => ({ answerChars: answer.length }),
    });
  }

  async ready(): Promise<TalonRuntimeInfo> {
    const runtime = await this.ensureRuntime();
    return {
      grpcEndpoint: runtime.server.grpcEndpoint,
      uiEndpoint: runtime.server.uiEndpoint,
      namespace: this.options.namespace,
      agentName: this.options.agentName,
      dataDir: this.options.dataDir,
      workspaceDir: this.options.workspaceDir,
      mcpServerName: this.options.mcpServerName,
      mcpTransport: this.options.mcpTransport,
      mcpTarget: this.options.mcpTarget,
      mcpArgs: this.options.mcpArgs,
    };
  }

  async ask(request: CompanyDelegateRequest): Promise<string> {
    if (!request.question.trim()) return "No question was provided for delegation.";
    await this.ensureWeave();
    return this.askOp(request);
  }

  private async askRuntime(request: CompanyDelegateRequest): Promise<string> {
    const runtime = await this.ensureRuntime();
    const sessionId = await this.sessionForMeeting(runtime, request);
    const streamController = new AbortController();
    const answerPromise = collectTalonAnswer(
      runtime.client.streamSessionParts(
        new gateway.StreamSessionPartsRequest({
          ns: this.options.namespace,
          agent: this.options.agentName,
          sessionId,
        }),
        { signal: streamController.signal, timeoutMs: 0 },
      ),
    );

    try {
      await runtime.client.sendMessage(
        new gateway.SendMessageRequest({
          ns: this.options.namespace,
          agent: this.options.agentName,
          sessionId,
          message: request.question,
          labels: {
            meetingId: request.meetingId,
            speakerId: request.speaker.id,
            speakerName: request.speaker.displayName,
          },
        }),
      );

      const answer = await withTimeout(
        answerPromise,
        this.options.timeoutMs,
        "Talon company agent timed out.",
      );
      return answer.trim() || "The Talon company agent returned no answer.";
    } finally {
      streamController.abort();
      void answerPromise.catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    const runtime = await this.initPromise?.catch(() => undefined);
    this.sessionsByMeeting.clear();
    await runtime?.server.stop();
  }

  private ensureRuntime(): Promise<TalonRuntime> {
    this.initPromise ??= this.startAfterWeave();
    return this.initPromise;
  }

  private ensureWeave(): Promise<boolean> {
    this.weaveInitPromise ??= initWeave(this.options.weaveProject);
    return this.weaveInitPromise;
  }

  private async startAfterWeave(): Promise<TalonRuntime> {
    await this.ensureWeave();
    return this.startRuntimeOp();
  }

  private async startRuntime(): Promise<TalonRuntime> {
    if (!this.options.apiKey) {
      throw new Error("Talon delegation requires OPENAI_API_KEY or WANDB_API_KEY.");
    }

    console.log(`[agent] starting Talon delegate agent=${this.options.agentName}`);
    const server = await startTalon({
      jwtSecret: this.options.jwtSecret,
      config: talonConfig(this.options),
    });

    const transport = createGrpcTransport({
      baseUrl: `http://${server.grpcEndpoint}`,
      httpVersion: "2",
      interceptors: [
        next => async req => {
          req.header.set("authorization", authorizationHeader(this.mintAuthToken()));
          return next(req);
        },
      ],
    });
    const client = createPromiseClient(gatewayConnect.GatewayService, transport);
    const runtime = { server, client };

    try {
      await this.bootstrapOp(runtime);
      console.log(`[agent] Talon delegate ready ${server.grpcEndpoint}`);
      return runtime;
    } catch (error) {
      await server.stop();
      throw error;
    }
  }

  private mintAuthToken(): string {
    return mintJwt(this.options.jwtSecret, {
      subject: "alfred-agent-talon-delegate",
      ttlSeconds: this.options.jwtTtlSeconds,
    });
  }

  private async bootstrapRuntime(runtime: TalonRuntime): Promise<void> {
    const mcpRefs: string[] = [];

    await runtime.client.createNamespace(
      new gateway.CreateNamespaceRequest({
        name: this.options.namespace,
        recursive: true,
        labels: {
          app: "alfred",
        },
      }),
    );

    await replaceMcpServer(runtime, this.options);
    mcpRefs.push(this.options.mcpServerName);

    const definition = this.agentDefinition(mcpRefs);
    try {
      await runtime.client.modifyAgent(
        new gateway.ModifyAgentRequest({
          ns: this.options.namespace,
          agent: this.options.agentName,
          definition,
        }),
      );
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await runtime.client.createAgent(
        new gateway.CreateAgentRequest({
          ns: this.options.namespace,
          name: this.options.agentName,
          definition,
        }),
      );
    }
  }

  private agentDefinition(mcpRefs: string[]): manifests.AgentDefinition {
    return new manifests.AgentDefinition({
      source: {
        case: "customSpec",
        value: new manifests.AgentSpec({
          systemPrompt: defaultTalonPrompt(),
          mcpServerRefs: mcpRefs,
          modelPolicy: new manifests.ModelPolicy({
            profiles: [
              new manifests.ModelProfile({
                name: "default",
                model: new manifests.Model({
                  provider: this.options.providerName,
                  name: this.options.model,
                  temperature: 0.2,
                }),
              }),
            ],
          }),
        }),
      },
    });
  }

  private async sessionForMeeting(
    runtime: TalonRuntime,
    request: CompanyDelegateRequest,
  ): Promise<string> {
    const existing = this.sessionsByMeeting.get(request.meetingId);
    if (existing) return existing;

    const response = await runtime.client.createSession(
      new gateway.CreateSessionRequest({
        ns: this.options.namespace,
        agent: this.options.agentName,
        labels: {
          meetingId: request.meetingId,
          speakerId: request.speaker.id,
          speakerName: request.speaker.displayName,
        },
      }),
    );
    this.sessionsByMeeting.set(request.meetingId, response.sessionId);
    return response.sessionId;
  }
}

export function createTalonCompanyDelegateFromEnv(
  env: Record<string, string | undefined>,
): TalonCompanyDelegate {
  const openAiApiKey = requireEnv(env, "OPENAI_API_KEY");
  const wandbApiKey = requireEnv(env, "WANDB_API_KEY");
  const jwtSecret = requireEnv(env, "TALON_JWT_SECRET");

  const providerKind = env.LLM_PROVIDER?.toLowerCase() === "wandb" ? "wandb" : "openai";
  const providerBaseUrl =
    env.TALON_PROVIDER_BASE_URL ??
    env.LLM_BASE_URL ??
    (providerKind === "wandb" ? WANDB_INFERENCE_BASE_URL : OPENAI_BASE_URL);
  const apiKey = providerKind === "wandb" ? wandbApiKey : openAiApiKey;
  const externalMcpUrl = env.TALON_COMPANY_MCP_URL ?? env.REDIS_MCP_URL;
  const mcpTransport: McpTransport = externalMcpUrl ? "http" : "stdio";

  return new TalonCompanyDelegate({
    apiKey,
    namespace: env.TALON_NAMESPACE ?? "alfred",
    agentName: env.TALON_COMPANY_AGENT ?? "company-memory",
    providerName: env.TALON_PROVIDER_NAME ?? providerKind,
    providerBaseUrl,
    model:
      env.TALON_MODEL ??
      env.OPENAI_DELEGATE_MODEL ??
      (providerKind === "wandb" ? "ibm-granite/granite-4.1-8b" : "gpt-4.1-mini"),
    dataDir: resolve(env.TALON_DATA_DIR ?? ".tools/talon/data"),
    workspaceDir: resolve(env.TALON_WORKSPACE_DIR ?? ".tools/talon/workspace"),
    jwtSecret,
    jwtTtlSeconds: readInteger(env.TALON_JWT_TTL_SECONDS, 86_400),
    weaveProject: env.WEAVE_PROJECT ?? "meeting-agent",
    mcpServerName: env.TALON_COMPANY_MCP_NAME ?? "company-memory",
    mcpTransport,
    mcpTarget: externalMcpUrl ?? env.TALON_MEMORY_MCP_COMMAND ?? process.execPath,
    mcpArgs: externalMcpUrl ? [] : readStringArray(env.TALON_MEMORY_MCP_ARGS_JSON, [DEFAULT_MEMORY_MCP_SCRIPT]),
    mcpHeaders: readJsonObject(env.TALON_COMPANY_MCP_HEADERS_JSON),
    timeoutMs: readInteger(env.TALON_DELEGATE_TIMEOUT_MS, 20_000),
  });
}

type TalonRuntime = {
  server: TalonServer;
  client: ReturnType<typeof createPromiseClient<typeof gatewayConnect.GatewayService>>;
};

function talonConfig(options: TalonCompanyDelegateOptions): TalonConfig {
  return {
    workspace_dir: options.workspaceDir,
    providers: {
      [options.providerName]: {
        type: "openai_compatible",
        base_url: options.providerBaseUrl,
        model: options.model,
        api_key: options.apiKey,
      },
    },
    default_provider: options.providerName,
    control_plane: {
      database: {
        driver: "sqlite",
        data_dir: options.dataDir,
      },
      message_broker: {
        driver: "local_socket",
      },
    },
  };
}

async function replaceMcpServer(
  runtime: TalonRuntime,
  options: TalonCompanyDelegateOptions,
): Promise<void> {
  await ignoreNotFound(() =>
    runtime.client.deleteMcpServer(new gateway.DeleteMcpServerRequest({ name: options.mcpServerName })),
  );
  await runtime.client.createMcpServer(
    new gateway.CreateMcpServerRequest({
      server: new manifests.McpServer({
        apiVersion: "talon.impalasys.com/v1",
        kind: "McpServer",
        metadata: new manifests.ObjectMeta({ name: options.mcpServerName }),
        spec: new manifests.McpServerSpec({
          transport: options.mcpTransport,
          target: options.mcpTarget,
          args: options.mcpArgs,
          headers: options.mcpHeaders,
        }),
      }),
    }),
  );
}

async function ignoreNotFound(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof ConnectError
    ? error.code === Code.NotFound
    : String(error).toLowerCase().includes("not found");
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timer]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function collectTalonAnswer(
  stream: AsyncIterable<events.SessionMessagePartEvent>,
): Promise<string> {
  let accumulated = "";

  for await (const event of stream) {
    const part = event.part;
    const content = part?.content ?? "";
    if (event.kind === events.SessionMessagePartEventKind.ERROR) {
      throw new Error(content || "Talon company agent stream failed.");
    }
    if (part?.partType !== models.SessionMessagePartType.TEXT) {
      continue;
    }
    if (event.kind === events.SessionMessagePartEventKind.DELTA) {
      accumulated += content;
      continue;
    }
    if (event.kind === events.SessionMessagePartEventKind.DONE) {
      return content || accumulated;
    }
  }

  return accumulated;
}

function defaultTalonPrompt(): string {
  return `You are Alfred's company-memory delegate. Answer only using available company context and tool results.

When a question concerns documents, Slack/project context, a colleague's notes, blockers, ship readiness, or Priya/onboarding redesign context, use the company-memory MCP tools before answering.

Return a concise, grounded answer for the voice model to speak. Include the relevant source or owner when available. If context is missing, say so plainly.`;
}

function readJsonObject(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([key, entryValue]) => [key, entryValue]),
    );
  } catch {
    return {};
  }
}

function readInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readStringArray(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return fallback;
    const values = parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
    return values.length > 0 ? values : fallback;
  } catch {
    return fallback;
  }
}

function requireEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`[agent] ${name} is required. Load it from .env or export it before running.`);
  }
  return value;
}
