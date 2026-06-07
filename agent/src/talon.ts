import { Code, ConnectError, createPromiseClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { events, gateway, gatewayConnect, manifests, models } from "@impalasys/talon-client";
import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, resolve } from "node:path";
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
import type {
  ActionItem,
  ActionItemMatchRequest,
  ActionItemsRequest,
  ActionItemStatus,
  CompanyDelegate,
  CompanyDelegateRequest,
  ToolUseListener,
  VisualPoint,
  VisualRequest,
  VisualSpec,
} from "./types";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const WANDB_INFERENCE_BASE_URL = "https://api.inference.wandb.ai/v1";
const DEFAULT_MEMORY_MCP_SCRIPT = fileURLToPath(new URL("./memory-mcp.ts", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DEFAULT_GOOGLE_CLIENT_SECRET_PATH = fileURLToPath(
  new URL("../../client_secret.json", import.meta.url),
);
const CHANNEL_REPLY_SUBSCRIPTION = "company-memory";

type McpTransport = "http" | "stdio";

export interface TalonMcpServerOptions {
  name: string;
  transport: McpTransport;
  target: string;
  args: string[];
  headers: Record<string, string>;
}

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
  mcpServers: TalonMcpServerOptions[];
  timeoutMs: number;
}

export interface TalonRuntimeInfo {
  grpcEndpoint: string;
  uiEndpoint: string;
  namespace: string;
  agentName: string;
  dataDir: string;
  workspaceDir: string;
  mcpServers: TalonMcpServerOptions[];
}

export class TalonCompanyDelegate implements CompanyDelegate {
  private readonly channelsByMeeting = new Map<string, Promise<string>>();
  private readonly toolUseListeners = new Set<ToolUseListener>();
  private readonly startRuntimeOp: () => Promise<TalonRuntime>;
  private readonly bootstrapOp: (runtime: TalonRuntime) => Promise<void>;
  private readonly askOp: (request: CompanyDelegateRequest) => Promise<string>;
  private readonly actionItemsOp: (request: ActionItemsRequest) => Promise<ActionItem[]>;
  private readonly matchActionItemOp: (request: ActionItemMatchRequest) => Promise<string | null>;
  private readonly buildVisualOp: (request: VisualRequest) => Promise<VisualSpec>;
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
        mcpServers: this.options.mcpServers.map(server => ({
          name: server.name,
          transport: server.transport,
        })),
      }),
    });
    this.askOp = weave.op(this, this.askRuntime, {
      name: "alfred.talon.ask",
      summarize: answer => ({ answerChars: answer.length }),
    });
    this.actionItemsOp = weave.op(this, this.actionItemsRuntime, {
      name: "alfred.talon.actionItems",
      summarize: items => ({ actionItemCount: items.length }),
    });
    this.matchActionItemOp = weave.op(this, this.matchActionItemRuntime, {
      name: "alfred.talon.matchActionItem",
      summarize: matchedId => ({ matchedId }),
    });
    this.buildVisualOp = weave.op(this, this.buildVisualRuntime, {
      name: "alfred.talon.buildVisual",
      summarize: spec => ({ kind: spec.kind, title: "title" in spec ? spec.title : undefined }),
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
      mcpServers: this.options.mcpServers,
    };
  }

  async ask(request: CompanyDelegateRequest): Promise<string> {
    if (!request.question.trim()) return "No question was provided for delegation.";
    await this.ensureWeave();
    return this.askOp(request);
  }

  private async askRuntime(request: CompanyDelegateRequest): Promise<string> {
    const runtime = await this.ensureRuntime();
    const channel = await this.channelForMeeting(runtime, request);
    const question = routedDelegateQuestion(request.question);
    const requestId = crypto.randomUUID();
    const streamController = new AbortController();
    let answerPromise: Promise<string> | undefined;

    try {
      const response = await runtime.client.postChannelMessage(
        new gateway.PostChannelMessageRequest({
          ns: this.options.namespace,
          channel,
          authorKind: "user",
          author: request.speaker.displayName || request.speaker.id,
          content: question,
          subscriptionNames: [CHANNEL_REPLY_SUBSCRIPTION],
          labels: {
            requestId,
            meetingId: request.meetingId,
            speakerId: request.speaker.id,
            speakerName: request.speaker.displayName,
          },
        }),
      );
      const routed = response.routedSessions.find(
        session => session.subscription === CHANNEL_REPLY_SUBSCRIPTION,
      );
      if (!routed || routed.error || !routed.sessionId) {
        throw new Error(routed?.error || "Talon channel did not route to the company delegate.");
      }
      console.log(
        `[agent] Talon channel routed request=${requestId} channel=${channel} session=${routed.sessionId}`,
      );

      answerPromise = collectTalonAnswer(
        runtime.client.streamSessionParts(
          new gateway.StreamSessionPartsRequest({
            ns: this.options.namespace,
            agent: this.options.agentName,
            sessionId: routed.sessionId,
          }),
          { signal: streamController.signal, timeoutMs: 0 },
        ),
        this.toolUseCollector(request.meetingId),
      );

      const answer = await withTimeout(
        answerPromise,
        this.options.timeoutMs,
        "Talon company agent timed out.",
      );
      return answer.trim() || "The Talon company agent returned no answer.";
    } finally {
      streamController.abort();
      void answerPromise?.catch(() => undefined);
    }
  }

  async extractActionItems(request: ActionItemsRequest): Promise<ActionItem[]> {
    if (!request.transcript.trim()) return [];
    await this.ensureWeave();
    return this.actionItemsOp(request);
  }

  private async actionItemsRuntime(request: ActionItemsRequest): Promise<ActionItem[]> {
    const runtime = await this.ensureRuntime();
    const channel = await this.channelForMeeting(runtime, {
      meetingId: request.meetingId,
      speaker: { id: "alfred", displayName: "Alfred" },
      question: "",
    });
    const requestId = crypto.randomUUID();
    const streamController = new AbortController();
    let answerPromise: Promise<string> | undefined;

    try {
      const response = await runtime.client.postChannelMessage(
        new gateway.PostChannelMessageRequest({
          ns: this.options.namespace,
          channel,
          authorKind: "user",
          author: "Alfred",
          content: actionItemsExtractionPrompt(request.transcript),
          subscriptionNames: [CHANNEL_REPLY_SUBSCRIPTION],
          labels: {
            requestId,
            meetingId: request.meetingId,
            kind: "action-items",
          },
        }),
      );
      const routed = response.routedSessions.find(
        session => session.subscription === CHANNEL_REPLY_SUBSCRIPTION,
      );
      if (!routed || routed.error || !routed.sessionId) {
        throw new Error(
          routed?.error || "Talon channel did not route action-item extraction to the delegate.",
        );
      }
      console.log(
        `[agent] Talon action items routed request=${requestId} channel=${channel} session=${routed.sessionId}`,
      );

      answerPromise = collectTalonAnswer(
        runtime.client.streamSessionParts(
          new gateway.StreamSessionPartsRequest({
            ns: this.options.namespace,
            agent: this.options.agentName,
            sessionId: routed.sessionId,
          }),
          { signal: streamController.signal, timeoutMs: 0 },
        ),
        this.toolUseCollector(request.meetingId),
      );

      const answer = await withTimeout(
        answerPromise,
        this.options.timeoutMs,
        "Talon action-item extraction timed out.",
      );
      return parseActionItems(answer);
    } finally {
      streamController.abort();
      void answerPromise?.catch(() => undefined);
    }
  }

  async matchActionItemForRemoval(request: ActionItemMatchRequest): Promise<string | null> {
    if (!request.query.trim() || request.items.length === 0) return null;
    await this.ensureWeave();
    return this.matchActionItemOp(request);
  }

  private async matchActionItemRuntime(request: ActionItemMatchRequest): Promise<string | null> {
    const runtime = await this.ensureRuntime();
    const channel = await this.channelForMeeting(runtime, {
      meetingId: request.meetingId,
      speaker: { id: "alfred", displayName: "Alfred" },
      question: "",
    });
    const requestId = crypto.randomUUID();
    const streamController = new AbortController();
    let answerPromise: Promise<string> | undefined;

    try {
      const response = await runtime.client.postChannelMessage(
        new gateway.PostChannelMessageRequest({
          ns: this.options.namespace,
          channel,
          authorKind: "user",
          author: "Alfred",
          content: actionItemMatchPrompt(request),
          subscriptionNames: [CHANNEL_REPLY_SUBSCRIPTION],
          labels: {
            requestId,
            meetingId: request.meetingId,
            kind: "action-item-match",
          },
        }),
      );
      const routed = response.routedSessions.find(
        session => session.subscription === CHANNEL_REPLY_SUBSCRIPTION,
      );
      if (!routed || routed.error || !routed.sessionId) {
        throw new Error(
          routed?.error || "Talon channel did not route action-item match to the delegate.",
        );
      }
      console.log(
        `[agent] Talon action-item match routed request=${requestId} channel=${channel} session=${routed.sessionId}`,
      );

      answerPromise = collectTalonAnswer(
        runtime.client.streamSessionParts(
          new gateway.StreamSessionPartsRequest({
            ns: this.options.namespace,
            agent: this.options.agentName,
            sessionId: routed.sessionId,
          }),
          { signal: streamController.signal, timeoutMs: 0 },
        ),
        this.toolUseCollector(request.meetingId),
      );

      const answer = await withTimeout(
        answerPromise,
        this.options.timeoutMs,
        "Talon action-item match timed out.",
      );
      return parseActionItemMatch(answer, request.items);
    } finally {
      streamController.abort();
      void answerPromise?.catch(() => undefined);
    }
  }

  async buildVisual(request: VisualRequest): Promise<VisualSpec> {
    if (!request.question.trim()) {
      return { kind: "text", text: "No request was provided to visualize." };
    }
    await this.ensureWeave();
    return this.buildVisualOp(request);
  }

  private async buildVisualRuntime(request: VisualRequest): Promise<VisualSpec> {
    const runtime = await this.ensureRuntime();
    const channel = await this.channelForMeeting(runtime, {
      meetingId: request.meetingId,
      speaker: { id: "alfred", displayName: "Alfred" },
      question: "",
    });
    const requestId = crypto.randomUUID();
    const streamController = new AbortController();
    let answerPromise: Promise<string> | undefined;

    try {
      const response = await runtime.client.postChannelMessage(
        new gateway.PostChannelMessageRequest({
          ns: this.options.namespace,
          channel,
          authorKind: "user",
          author: "Alfred",
          content: visualBuildPrompt(request.question),
          subscriptionNames: [CHANNEL_REPLY_SUBSCRIPTION],
          labels: {
            requestId,
            meetingId: request.meetingId,
            kind: "build-visual",
          },
        }),
      );
      const routed = response.routedSessions.find(
        session => session.subscription === CHANNEL_REPLY_SUBSCRIPTION,
      );
      if (!routed || routed.error || !routed.sessionId) {
        throw new Error(
          routed?.error || "Talon channel did not route the visual build to the delegate.",
        );
      }
      console.log(
        `[agent] Talon build-visual routed request=${requestId} channel=${channel} session=${routed.sessionId}`,
      );

      answerPromise = collectTalonAnswer(
        runtime.client.streamSessionParts(
          new gateway.StreamSessionPartsRequest({
            ns: this.options.namespace,
            agent: this.options.agentName,
            sessionId: routed.sessionId,
          }),
          { signal: streamController.signal, timeoutMs: 0 },
        ),
        this.toolUseCollector(request.meetingId),
      );

      const answer = await withTimeout(
        answerPromise,
        this.options.timeoutMs,
        "Talon visual build timed out.",
      );
      return parseVisualSpec(answer);
    } finally {
      streamController.abort();
      void answerPromise?.catch(() => undefined);
    }
  }

  onToolUse(listener: ToolUseListener): () => void {
    this.toolUseListeners.add(listener);
    return () => {
      this.toolUseListeners.delete(listener);
    };
  }

  // Build a per-operation tool collector: dedupes by name and notifies listeners
  // as each new tool resolves, so ctl can highlight the integration immediately.
  private toolUseCollector(meetingId: string): (name: string) => void {
    const seen = new Set<string>();
    return (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      this.emitToolUse(meetingId, [trimmed]);
    };
  }

  private emitToolUse(meetingId: string, tools: string[]): void {
    if (tools.length === 0 || this.toolUseListeners.size === 0) return;
    const event = { meetingId, tools };
    for (const listener of this.toolUseListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[agent] onToolUse listener failed", error);
      }
    }
  }

  async close(): Promise<void> {
    const runtime = await this.initPromise?.catch(() => undefined);
    this.channelsByMeeting.clear();
    this.toolUseListeners.clear();
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

    for (const mcpServer of this.options.mcpServers) {
      await replaceMcpServer(runtime, mcpServer);
      mcpRefs.push(mcpServer.name);
    }

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

  private channelForMeeting(
    runtime: TalonRuntime,
    request: CompanyDelegateRequest,
  ): Promise<string> {
    const existing = this.channelsByMeeting.get(request.meetingId);
    if (existing) return existing;

    const channelPromise = this.createMeetingChannel(runtime, request).catch(error => {
      this.channelsByMeeting.delete(request.meetingId);
      throw error;
    });
    this.channelsByMeeting.set(request.meetingId, channelPromise);
    return channelPromise;
  }

  private async createMeetingChannel(
    runtime: TalonRuntime,
    request: CompanyDelegateRequest,
  ): Promise<string> {
    const channel = channelNameForMeeting(request.meetingId);
    await ignoreAlreadyExists(() =>
      runtime.client.createChannel(
        new gateway.CreateChannelRequest({
          ns: this.options.namespace,
          channel: new models.Channel({
            name: channel,
            title: `Alfred meeting ${request.meetingId}`,
            status: "open",
            labels: {
              app: "alfred",
              meetingId: request.meetingId,
            },
          }),
        }),
      ),
    );

    await replaceChannelSubscription(runtime, {
      namespace: this.options.namespace,
      channel,
      name: CHANNEL_REPLY_SUBSCRIPTION,
      agent: this.options.agentName,
    });
    return channel;
  }
}

interface ChannelSubscriptionConfig {
  namespace: string;
  channel: string;
  name: string;
  agent: string;
}

async function replaceChannelSubscription(
  runtime: TalonRuntime,
  config: ChannelSubscriptionConfig,
): Promise<void> {
  const subscription = new models.ChannelSubscription({
    name: config.name,
    channel: config.channel,
    agent: config.agent,
    enabled: true,
    trigger: "manual",
    replyMode: "tool",
    contextPolicy: new models.ChannelContextPolicy({
      mode: "recent_public",
      maxMessages: 10,
    }),
    labels: {
      app: "alfred",
    },
  });

  try {
    await runtime.client.modifyChannelSubscription(
      new gateway.ModifyChannelSubscriptionRequest({
        ns: config.namespace,
        channel: config.channel,
        name: config.name,
        subscription,
      }),
    );
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await runtime.client.createChannelSubscription(
      new gateway.CreateChannelSubscriptionRequest({
        ns: config.namespace,
        channel: config.channel,
        subscription,
      }),
    );
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
  const mcpServers = [
    {
      name: env.TALON_COMPANY_MCP_NAME ?? "company-memory",
      transport: mcpTransport,
      target: externalMcpUrl ?? env.TALON_MEMORY_MCP_COMMAND ?? process.execPath,
      args: externalMcpUrl
        ? []
        : readStringArray(env.TALON_MEMORY_MCP_ARGS_JSON, [DEFAULT_MEMORY_MCP_SCRIPT]),
      headers: readJsonObject(env.TALON_COMPANY_MCP_HEADERS_JSON),
    },
  ];
  const workspaceMcp = buildWorkspaceMcpServer(env);
  if (workspaceMcp) mcpServers.push(workspaceMcp);
  const searchMcp = buildSearchMcpServer(env);
  if (searchMcp) mcpServers.push(searchMcp);

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
    mcpServers,
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
  server: TalonMcpServerOptions,
): Promise<void> {
  await ignoreNotFound(() =>
    runtime.client.deleteMcpServer(new gateway.DeleteMcpServerRequest({ name: server.name })),
  );
  await runtime.client.createMcpServer(
    new gateway.CreateMcpServerRequest({
      server: new manifests.McpServer({
        apiVersion: "talon.impalasys.com/v1",
        kind: "McpServer",
        metadata: new manifests.ObjectMeta({ name: server.name }),
        spec: new manifests.McpServerSpec({
          transport: server.transport,
          target: server.target,
          args: server.args,
          headers: server.headers,
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

async function ignoreAlreadyExists(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (isAlreadyExists(error)) return;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof ConnectError
    ? error.code === Code.NotFound
    : String(error).toLowerCase().includes("not found");
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof ConnectError
    ? error.code === Code.AlreadyExists
    : String(error).toLowerCase().includes("already exists");
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
  onTool?: (name: string) => void,
): Promise<string> {
  let accumulated = "";
  let completedText = "";
  const iterator = stream[Symbol.asyncIterator]();

  for (;;) {
    const nextEvent = await nextWithQuietTimeout(iterator, completedText ? 900 : undefined);
    if (nextEvent === "quiet") {
      console.log(
        `[agent] Talon routed session quiet; returning ${completedText.length} chars`,
      );
      return completedText;
    }
    if (nextEvent.done) break;

    const event = nextEvent.value;
    const part = event.part;
    const content = part?.content ?? "";
    if (event.kind === events.SessionMessagePartEventKind.ERROR) {
      throw new Error(content || "Talon company agent stream failed.");
    }
    logSessionPartEvent(event);
    // Surface each resolved tool call so the caller can map it to a live UI
    // integration highlight. DONE keeps it to one signal per call (not per delta).
    if (
      onTool &&
      event.kind === events.SessionMessagePartEventKind.DONE &&
      part?.partType === models.SessionMessagePartType.TOOL_CALL &&
      part.name
    ) {
      onTool(part.name);
    }
    if (part?.partType !== models.SessionMessagePartType.TEXT) {
      continue;
    }
    if (event.kind === events.SessionMessagePartEventKind.DELTA) {
      accumulated += content;
      continue;
    }
    if (event.kind === events.SessionMessagePartEventKind.DONE) {
      completedText = content || accumulated;
      accumulated = "";
    }
  }

  return completedText || accumulated;
}

async function nextWithQuietTimeout<T>(
  iterator: AsyncIterator<T>,
  quietMs: number | undefined,
): Promise<IteratorResult<T> | "quiet"> {
  if (!quietMs) return iterator.next();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const quiet = new Promise<"quiet">(resolve => {
    timeout = setTimeout(() => resolve("quiet"), quietMs);
  });
  try {
    return await Promise.race([iterator.next(), quiet]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function logSessionPartEvent(event: events.SessionMessagePartEvent): void {
  if (event.kind !== events.SessionMessagePartEventKind.DONE) return;

  const part = event.part;
  if (!part) {
    console.log(`[agent] Talon routed session part done empty session=${event.sessionId}`);
    return;
  }

  if (part.partType === models.SessionMessagePartType.TEXT) {
    console.log(
      `[agent] Talon routed session text done session=${event.sessionId} chars=${part.content.length}: ${truncateLog(part.content, 220)}`,
    );
    return;
  }

  const typeName = sessionPartTypeName(part.partType);
  const payload = part.payloadJson || part.content;
  console.log(
    `[agent] Talon routed session ${typeName} done session=${event.sessionId} name=${part.name || "<none>"} payload=${truncateLog(payload, 220)}`,
  );
}

function sessionPartTypeName(value: models.SessionMessagePartType): string {
  return models.SessionMessagePartType[value] ?? `part_${value}`;
}

function truncateLog(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function channelNameForMeeting(meetingId: string): string {
  const normalized = meetingId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 220);
  return `meeting-${normalized || "default"}`;
}

function defaultTalonPrompt(): string {
  return `You are Alfred's company-memory delegate. Answer only using available company context and tool results.

Tool routing:
- For internal company questions, including company docs, Slack/project context, colleague notes, blockers, ship readiness, Priya, onboarding redesign, priorities, changes, or announcements, use company-memory first.
- Use Google Workspace only for read-only retrieval from the user's real Drive, Docs, Gmail, or Calendar. Before calling a Google Workspace tool that needs a document/file id, get that id from a prior Google Workspace search/list/get result or from an explicit user-provided URL/id.
- Use DuckDuckGo only for public web questions or current external facts. Do not use web search to answer private company-memory questions unless the user asks for public context.
- For public questions involving latest, current, today, this week, news, markets, market close, stocks, or other time-sensitive facts, use DuckDuckGo before answering. Do not answer those from model memory.

Never invent document ids, file ids, URLs, Slack links, calendar ids, or "latest" document names. If a needed id or document is not present in tool results, say the context is missing instead of guessing.
Never invent current public facts. If web search results are unavailable or insufficient, say you could not retrieve current public data.

Never send emails, edit documents, change sharing, create files, create calendar events, or perform any other side effect.

When this session is triggered by a Talon channel, still write the final concise answer as normal assistant text. Alfred reads the routed session output directly. If channel_publish is available, do not rely on it as the only answer.

Return a concise, grounded answer for the voice model to speak. Include the relevant source or owner when available. If context is missing, say so plainly.`;
}

function actionItemsExtractionPrompt(transcript: string): string {
  return [
    "You are extracting end-of-meeting action items from a meeting transcript.",
    "Read the transcript below and identify only concrete, assignable follow-up tasks that were agreed or requested during the meeting.",
    "Rules:",
    "- Infer the assignee from names mentioned for each task; if no owner is clear, use \"Unassigned\".",
    "- Each item status is \"open\" unless the transcript clearly states it is already completed (then \"done\").",
    "- Do not invent tasks. If the transcript contains no real action items, return an empty array.",
    "Respond with ONLY a JSON array (no prose, no markdown fences) of objects with this exact shape:",
    '[{"title": string, "assignee": string, "status": "open" | "done"}]',
    "",
    "Transcript:",
    transcript,
  ].join("\n");
}

function parseActionItems(answer: string): ActionItem[] {
  const json = extractJsonArray(answer);
  if (!json) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const items: ActionItem[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    if (!title) continue;
    const assignee =
      typeof record.assignee === "string" && record.assignee.trim()
        ? record.assignee.trim()
        : "Unassigned";
    const status: ActionItemStatus = record.status === "done" ? "done" : "open";
    items.push({ title, assignee, status });
  }
  return items;
}

// Models sometimes wrap the JSON in prose or markdown fences; pull out the array.
function extractJsonArray(value: string): string | undefined {
  const start = value.indexOf("[");
  const end = value.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return undefined;
  return value.slice(start, end + 1);
}

function actionItemMatchPrompt(request: ActionItemMatchRequest): string {
  const items = request.items.map(item => ({
    id: item.id,
    title: item.title,
    assignee: item.assignee,
  }));
  return [
    "A meeting participant wants to remove one action item from the list below.",
    "Decide which single item they mean, allowing for paraphrase, synonyms, reordered or",
    "missing words, and digits written as words.",
    `Participant said: "${request.query}"`,
    "Current action items (JSON):",
    JSON.stringify(items),
    'Respond with ONLY the "id" of the single best matching item. If no item is a reasonable',
    'match, respond with exactly "none". Output just the id or "none" — no other text.',
  ].join("\n");
}

// The model is asked to return a bare id (or "none"). Be liberal: accept the id even if
// it arrives wrapped in punctuation/prose, but only if it is a real id from the list.
function parseActionItemMatch(
  answer: string,
  items: ActionItemMatchRequest["items"],
): string | null {
  const normalized = answer.toLowerCase();
  if (/\bnone\b/.test(normalized) && !items.some(item => normalized.includes(item.id.toLowerCase()))) {
    return null;
  }
  const match = items.find(item => normalized.includes(item.id.toLowerCase()));
  return match ? match.id : null;
}

function visualBuildPrompt(question: string): string {
  return [
    "A meeting participant asked Alfred to pull up / show / visualize some company data.",
    `Request: "${question}"`,
    "",
    "First, retrieve the relevant data from company memory using company_memory_search and",
    "company_memory_get. Some documents include a structured \"Data (JSON)\" payload with exact",
    "numbers — prefer those for charts. Do not invent numbers — only use tool results.",
    "",
    "Then decide the single representation that best communicates the answer and output it as JSON.",
    "Choose the kind that fits the data:",
    '- "pie": parts of a whole (e.g. revenue split by category for one period).',
    '- "bar": comparing a metric across a few labels (e.g. revenue by quarter).',
    '- "line": a trend over an ordered sequence (e.g. net income over quarters).',
    '- "table": multiple columns of values that do not chart cleanly.',
    '- "text": a short factual answer with no useful chart.',
    "",
    "Respond with ONLY a JSON object (no prose, no markdown fences) matching exactly one of:",
    '{"kind":"pie"|"bar"|"line","title":string,"subtitle"?:string,"unit"?:string,"series":[{"label":string,"value":number}]}',
    '{"kind":"table","title":string,"subtitle"?:string,"columns":string[],"rows":(string|number)[][]}',
    '{"kind":"text","title"?:string,"text":string}',
    "",
    "Rules: numeric values must be plain numbers (no commas, currency symbols, or units in the number).",
    'Put any currency/unit hint in "unit" (e.g. "$"). Keep the title short. Prefer 2-8 data points.',
  ].join("\n");
}

// Pulls the first balanced JSON object out of the model output (it may wrap the
// object in prose or markdown fences).
function extractJsonObject(value: string): string | undefined {
  const start = value.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  return undefined;
}

function parseVisualSpec(answer: string): VisualSpec {
  const json = extractJsonObject(answer);
  const fallback: VisualSpec = {
    kind: "text",
    text: answer.trim() || "Alfred could not build a visual for that request.",
  };
  if (!json) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
  const record = parsed as Record<string, unknown>;
  const kind = record.kind;

  if (kind === "pie" || kind === "bar" || kind === "line") {
    const series = parseVisualSeries(record.series);
    if (series.length === 0) return fallback;
    return {
      kind,
      title: readSpecString(record.title) || "Untitled",
      subtitle: optionalSpecString(record.subtitle),
      unit: optionalSpecString(record.unit),
      series,
    };
  }

  if (kind === "table") {
    const columns = Array.isArray(record.columns)
      ? record.columns.filter((value): value is string => typeof value === "string")
      : [];
    const rows = parseVisualRows(record.rows);
    if (columns.length === 0 || rows.length === 0) return fallback;
    return {
      kind: "table",
      title: readSpecString(record.title) || "Untitled",
      subtitle: optionalSpecString(record.subtitle),
      columns,
      rows,
    };
  }

  if (kind === "text") {
    const text = readSpecString(record.text);
    if (!text) return fallback;
    return { kind: "text", title: optionalSpecString(record.title), text };
  }

  return fallback;
}

function parseVisualSeries(value: unknown): VisualPoint[] {
  if (!Array.isArray(value)) return [];
  const points: VisualPoint[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const label = typeof record.label === "string" ? record.label.trim() : "";
    const numeric = coerceNumber(record.value);
    if (!label || numeric === undefined) continue;
    points.push({ label, value: numeric });
  }
  return points;
}

function parseVisualRows(value: unknown): Array<Array<string | number>> {
  if (!Array.isArray(value)) return [];
  const rows: Array<Array<string | number>> = [];
  for (const entry of value) {
    if (!Array.isArray(entry)) continue;
    const cells = entry.map(cell => {
      if (typeof cell === "number" && Number.isFinite(cell)) return cell;
      if (typeof cell === "string") return cell;
      return String(cell ?? "");
    });
    rows.push(cells);
  }
  return rows;
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const cleaned = Number.parseFloat(value.replace(/[,$%\s]/g, ""));
    return Number.isFinite(cleaned) ? cleaned : undefined;
  }
  return undefined;
}

function readSpecString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalSpecString(value: unknown): string | undefined {
  const text = readSpecString(value);
  return text || undefined;
}

function routedDelegateQuestion(question: string): string {
  if (!isCurrentPublicQuestion(question)) return question;
  const today = new Date().toISOString().slice(0, 10);
  return [
    "This is a current public web question.",
    `Today's date is ${today}. Interpret relative dates against this date.`,
    "You must call functions.mcp_duckduckgo_search_search before answering.",
    "Use a targeted search query that includes the current year and any relevant current date/week terms.",
    "Do not answer from model memory. If search results are unavailable or insufficient, say you could not retrieve current public data.",
    `Question: ${question}`,
  ].join("\n");
}

function isCurrentPublicQuestion(question: string): boolean {
  const normalized = question.toLowerCase();
  const hasFreshness =
    /\b(latest|current|today|this week|this month|recent|news|market close|closed this week)\b/.test(
      normalized,
    );
  const hasPublicTopic =
    /\b(market|markets|stock|stocks|index|indexes|indices|s&p|nasdaq|dow|treasury|bond|bonds|fed|inflation|earnings|crypto|bitcoin|oil)\b/.test(
      normalized,
    );
  return hasFreshness && hasPublicTopic;
}

function buildWorkspaceMcpServer(
  env: Record<string, string | undefined>,
): TalonMcpServerOptions | undefined {
  const enabled = readBoolean(env.TALON_WORKSPACE_MCP_ENABLED, true);
  if (!enabled) return undefined;

  const auth = workspaceMcpAuthState(env);
  if (!auth.authable) {
    console.warn(`[agent] skipping Google Workspace MCP: ${auth.reason}`);
    return undefined;
  }
  if (auth.clientSecretPath && !env.GOOGLE_CLIENT_SECRET_PATH) {
    env.GOOGLE_CLIENT_SECRET_PATH = auth.clientSecretPath;
  }

  const command = env.TALON_WORKSPACE_MCP_COMMAND ?? "uvx";
  if (!commandExists(command, env.PATH)) {
    console.warn(`[agent] skipping Google Workspace MCP: ${command} is not executable`);
    return undefined;
  }

  return {
    name: env.TALON_WORKSPACE_MCP_NAME ?? "google-workspace",
    transport: "stdio",
    target: command,
    args: readStringArray(env.TALON_WORKSPACE_MCP_ARGS_JSON, [
      "workspace-mcp",
      "--single-user",
      "--tools",
      "gmail",
      "drive",
      "docs",
      "calendar",
      "--read-only",
    ]),
    headers: {},
  };
}

function workspaceMcpAuthState(env: Record<string, string | undefined>): {
  authable: boolean;
  reason: string;
  clientSecretPath?: string;
} {
  if (env.GOOGLE_OAUTH_CLIENT_ID?.trim()) {
    if (env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()) {
      return { authable: true, reason: "GOOGLE_OAUTH_CLIENT_ID/SECRET are set" };
    }
    if (env.FASTMCP_SERVER_AUTH_GOOGLE_JWT_SIGNING_KEY?.trim()) {
      return {
        authable: true,
        reason: "GOOGLE_OAUTH_CLIENT_ID and FASTMCP_SERVER_AUTH_GOOGLE_JWT_SIGNING_KEY are set",
      };
    }
  }

  const clientSecretPath = resolveRepoPath(
    env.GOOGLE_CLIENT_SECRET_PATH ?? env.GOOGLE_CLIENT_SECRETS,
    DEFAULT_GOOGLE_CLIENT_SECRET_PATH,
  );
  if (existsSync(clientSecretPath)) {
    return { authable: true, reason: `${clientSecretPath} exists`, clientSecretPath };
  }

  return {
    authable: false,
    reason:
      "set Google OAuth env credentials, GOOGLE_CLIENT_SECRET_PATH, or provide client_secret.json",
  };
}

function buildSearchMcpServer(
  env: Record<string, string | undefined>,
): TalonMcpServerOptions | undefined {
  const enabled = readBoolean(env.TALON_SEARCH_MCP_ENABLED, true);
  if (!enabled) return undefined;

  const command = env.TALON_SEARCH_MCP_COMMAND ?? "uvx";
  if (!commandExists(command, env.PATH)) {
    console.warn(`[agent] skipping DuckDuckGo search MCP: ${command} is not executable`);
    return undefined;
  }

  return {
    name: env.TALON_SEARCH_MCP_NAME ?? "duckduckgo-search",
    transport: "stdio",
    target: command,
    args: readStringArray(env.TALON_SEARCH_MCP_ARGS_JSON, [
      "duckduckgo-mcp-server",
    ]),
    headers: {},
  };
}

function resolveRepoPath(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return value.startsWith("/") ? value : resolve(REPO_ROOT, value);
}

function commandExists(command: string, pathValue: string | undefined): boolean {
  if (command.includes("/")) return isExecutable(command);
  for (const entry of (pathValue ?? "").split(delimiter)) {
    if (!entry) continue;
    if (isExecutable(resolve(entry, command))) return true;
  }
  return false;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
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

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.toLowerCase();
  return normalized !== "0" && normalized !== "false" && normalized !== "off";
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
