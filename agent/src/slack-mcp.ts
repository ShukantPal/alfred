import { createInterface } from "node:readline";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

interface ToolCallParams {
  name?: string;
  arguments?: Record<string, unknown>;
}

interface SlackChannel {
  id: string;
  name?: string;
  is_channel?: boolean;
  is_group?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  is_member?: boolean;
  topic?: { value?: string };
  purpose?: { value?: string };
}

interface SlackMessage {
  type?: string;
  subtype?: string;
  user?: string;
  username?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  reply_count?: number;
  permalink?: string;
}

interface SlackUser {
  id: string;
  name?: string;
  real_name?: string;
  profile?: {
    email?: string;
    display_name?: string;
    real_name?: string;
  };
  deleted?: boolean;
  is_bot?: boolean;
}

const SERVER_INFO = {
  name: "alfred-slack-bot",
  version: "0.1.0",
};

const DEFAULT_CHANNEL_TYPES = "public_channel,private_channel";
const MAX_LIMIT = 100;

const tools = [
  {
    name: "slack_auth_test",
    description: "Check whether Alfred's Slack bot token is valid and show the workspace/user metadata.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "slack_list_channels",
    description:
      "List Slack conversations visible to the bot. Private channels are only visible if the bot is a member.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional case-insensitive substring to match against channel name, topic, or purpose.",
        },
        limit: {
          type: "number",
          description: "Maximum number of channels to return.",
          minimum: 1,
          maximum: MAX_LIMIT,
        },
        types: {
          type: "string",
          description:
            "Slack conversation types, comma-separated. Default: public_channel,private_channel.",
        },
      },
    },
  },
  {
    name: "slack_read_channel",
    description: "Read recent messages from a Slack channel/conversation by id.",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: {
          type: "string",
          description: "Slack channel/conversation id, for example C123 or G123.",
        },
        limit: {
          type: "number",
          description: "Maximum number of recent messages to return.",
          minimum: 1,
          maximum: MAX_LIMIT,
        },
      },
      required: ["channel_id"],
    },
  },
  {
    name: "slack_read_thread",
    description: "Read a Slack message thread by channel id and thread timestamp.",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: {
          type: "string",
          description: "Slack channel/conversation id.",
        },
        thread_ts: {
          type: "string",
          description: "Thread timestamp from a parent message.",
        },
        limit: {
          type: "number",
          description: "Maximum number of replies to return.",
          minimum: 1,
          maximum: MAX_LIMIT,
        },
      },
      required: ["channel_id", "thread_ts"],
    },
  },
  {
    name: "slack_search_recent_messages",
    description:
      "Best-effort read-only search over recent Slack messages by scanning visible channels. This is not Slack global search; the bot can only scan conversations it can read.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keywords to find in recent Slack message text.",
        },
        channel_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional channel ids to scan. If omitted, visible public/private channels are scanned.",
        },
        channel_names: {
          type: "array",
          items: { type: "string" },
          description: "Optional channel names to scan.",
        },
        limit: {
          type: "number",
          description: "Maximum matching messages to return.",
          minimum: 1,
          maximum: MAX_LIMIT,
        },
        messages_per_channel: {
          type: "number",
          description: "Number of recent messages to scan per channel.",
          minimum: 1,
          maximum: MAX_LIMIT,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "slack_find_users",
    description: "Find Slack users visible to the bot by name, display name, real name, or email substring.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Case-insensitive user search text.",
        },
        limit: {
          type: "number",
          description: "Maximum users to return.",
          minimum: 1,
          maximum: MAX_LIMIT,
        },
      },
      required: ["query"],
    },
  },
];

const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

rl.on("line", line => {
  void handleLine(line);
});

async function handleLine(line: string): Promise<void> {
  if (!line.trim()) return;

  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    writeError(null, -32700, "Parse error");
    return;
  }

  if (request.id === undefined) return;

  try {
    const result = await handleRequest(request);
    writeResponse(request.id, result);
  } catch (error) {
    writeError(request.id, -32603, error instanceof Error ? error.message : String(error));
  }
}

async function handleRequest(request: JsonRpcRequest): Promise<unknown> {
  switch (request.method) {
    case "initialize":
      return {
        protocolVersion: requestedProtocolVersion(request.params),
        capabilities: {
          tools: {},
        },
        serverInfo: SERVER_INFO,
      };
    case "tools/list":
      return { tools };
    case "tools/call":
      return callTool(readToolParams(request.params));
    case "ping":
      return {};
    default:
      throw new Error(`Unsupported MCP method: ${request.method ?? "<missing>"}`);
  }
}

async function callTool(params: ToolCallParams): Promise<unknown> {
  const args = params.arguments ?? {};
  switch (params.name) {
    case "slack_auth_test": {
      const result = await slackApi<Record<string, unknown>>("auth.test");
      return toolTextResult(formatObject(result), { auth: result });
    }
    case "slack_list_channels": {
      const channels = await listChannels({
        query: readOptionalString(args.query),
        limit: readOptionalNumber(args.limit, 50),
        types: readOptionalString(args.types) ?? DEFAULT_CHANNEL_TYPES,
      });
      return toolTextResult(formatChannels(channels), { channels });
    }
    case "slack_read_channel": {
      const channelId = readString(args.channel_id, "channel_id");
      const messages = await readChannel(channelId, readOptionalNumber(args.limit, 30));
      return toolTextResult(formatMessages(messages), { messages });
    }
    case "slack_read_thread": {
      const channelId = readString(args.channel_id, "channel_id");
      const threadTs = readString(args.thread_ts, "thread_ts");
      const messages = await readThread(channelId, threadTs, readOptionalNumber(args.limit, 50));
      return toolTextResult(formatMessages(messages), { messages });
    }
    case "slack_search_recent_messages": {
      const results = await searchRecentMessages({
        query: readString(args.query, "query"),
        channelIds: readOptionalStringArray(args.channel_ids),
        channelNames: readOptionalStringArray(args.channel_names),
        limit: readOptionalNumber(args.limit, 20),
        messagesPerChannel: readOptionalNumber(args.messages_per_channel, 40),
      });
      return toolTextResult(formatSearchResults(results), { results });
    }
    case "slack_find_users": {
      const users = await findUsers(readString(args.query, "query"), readOptionalNumber(args.limit, 20));
      return toolTextResult(formatUsers(users), { users });
    }
    default:
      throw new Error(`Unknown Slack tool: ${params.name ?? "<missing>"}`);
  }
}

async function listChannels(options: {
  query?: string;
  limit: number;
  types: string;
}): Promise<SlackChannel[]> {
  const channels: SlackChannel[] = [];
  let cursor = "";
  const normalizedQuery = options.query?.toLowerCase();
  do {
    const response = await slackApi<{
      channels?: SlackChannel[];
      response_metadata?: { next_cursor?: string };
    }>("conversations.list", {
      exclude_archived: "true",
      limit: "200",
      types: options.types,
      cursor,
    });
    for (const channel of response.channels ?? []) {
      if (!normalizedQuery || channelMatches(channel, normalizedQuery)) {
        channels.push(channel);
        if (channels.length >= options.limit) return channels;
      }
    }
    cursor = response.response_metadata?.next_cursor ?? "";
  } while (cursor);
  return channels;
}

async function readChannel(channelId: string, limit: number): Promise<SlackMessage[]> {
  const response = await slackApi<{ messages?: SlackMessage[] }>("conversations.history", {
    channel: channelId,
    limit: String(limit),
  });
  return addPermalinks(channelId, response.messages ?? []);
}

async function readThread(
  channelId: string,
  threadTs: string,
  limit: number,
): Promise<SlackMessage[]> {
  const response = await slackApi<{ messages?: SlackMessage[] }>("conversations.replies", {
    channel: channelId,
    ts: threadTs,
    limit: String(limit),
  });
  return addPermalinks(channelId, response.messages ?? []);
}

async function searchRecentMessages(options: {
  query: string;
  channelIds: string[];
  channelNames: string[];
  limit: number;
  messagesPerChannel: number;
}): Promise<Array<{ channel: SlackChannel; message: SlackMessage }>> {
  const queryTerms = options.query
    .toLowerCase()
    .split(/\s+/)
    .map(term => term.trim())
    .filter(Boolean);
  const channels = await channelsForSearch(options.channelIds, options.channelNames);
  const results: Array<{ channel: SlackChannel; message: SlackMessage }> = [];
  for (const channel of channels) {
    if (!channel.id) continue;
    let messages: SlackMessage[];
    try {
      messages = await readChannel(channel.id, options.messagesPerChannel);
    } catch (error) {
      process.stderr.write(
        `[slack-mcp] skipped ${channel.name ?? channel.id}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      continue;
    }
    for (const message of messages) {
      const text = message.text?.toLowerCase() ?? "";
      if (queryTerms.every(term => text.includes(term))) {
        results.push({ channel, message });
        if (results.length >= options.limit) return results;
      }
    }
  }
  return results;
}

async function channelsForSearch(
  channelIds: string[],
  channelNames: string[],
): Promise<SlackChannel[]> {
  if (channelIds.length > 0) return channelIds.map(id => ({ id }));
  const channels = await listChannels({
    limit: MAX_LIMIT,
    types: DEFAULT_CHANNEL_TYPES,
  });
  if (channelNames.length === 0) return channels;
  const wanted = new Set(channelNames.map(name => name.replace(/^#/, "").toLowerCase()));
  return channels.filter(channel => channel.name && wanted.has(channel.name.toLowerCase()));
}

async function findUsers(query: string, limit: number): Promise<SlackUser[]> {
  const normalized = query.toLowerCase();
  const users: SlackUser[] = [];
  let cursor = "";
  do {
    const response = await slackApi<{
      members?: SlackUser[];
      response_metadata?: { next_cursor?: string };
    }>("users.list", {
      limit: "200",
      cursor,
    });
    for (const user of response.members ?? []) {
      if (user.deleted) continue;
      if (userMatches(user, normalized)) {
        users.push(user);
        if (users.length >= limit) return users;
      }
    }
    cursor = response.response_metadata?.next_cursor ?? "";
  } while (cursor);
  return users;
}

async function addPermalinks(channelId: string, messages: SlackMessage[]): Promise<SlackMessage[]> {
  return Promise.all(
    messages.map(async message => {
      if (!message.ts) return message;
      try {
        const response = await slackApi<{ permalink?: string }>("chat.getPermalink", {
          channel: channelId,
          message_ts: message.ts,
        });
        return { ...message, permalink: response.permalink };
      } catch {
        return message;
      }
    }),
  );
}

async function slackApi<T extends Record<string, unknown>>(
  method: string,
  params: Record<string, string> = {},
): Promise<T> {
  const token = slackToken();
  const body = new URLSearchParams(params);
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = (await response.json()) as T & { ok?: boolean; error?: string };
  if (!response.ok || !data.ok) {
    const error = data.error ?? `${response.status} ${response.statusText}`;
    throw new Error(`Slack API ${method} failed: ${error}`);
  }
  return data;
}

function slackToken(): string {
  const token =
    process.env.SLACK_BOT_TOKEN?.trim() ||
    process.env.TALON_SLACK_BOT_TOKEN?.trim() ||
    process.env.TALON_SLACK_MCP_AUTH_TOKEN?.trim();
  if (!token) {
    throw new Error("Set SLACK_BOT_TOKEN, TALON_SLACK_BOT_TOKEN, or TALON_SLACK_MCP_AUTH_TOKEN.");
  }
  return token;
}

function channelMatches(channel: SlackChannel, query: string): boolean {
  return [
    channel.id,
    channel.name,
    channel.topic?.value,
    channel.purpose?.value,
  ].some(value => value?.toLowerCase().includes(query));
}

function userMatches(user: SlackUser, query: string): boolean {
  return [
    user.id,
    user.name,
    user.real_name,
    user.profile?.display_name,
    user.profile?.real_name,
    user.profile?.email,
  ].some(value => value?.toLowerCase().includes(query));
}

function formatChannels(channels: SlackChannel[]): string {
  if (channels.length === 0) return "No Slack channels were found.";
  return channels
    .map(channel =>
      [
        `${channel.name ? `#${channel.name}` : channel.id} (${channel.id})`,
        `private=${Boolean(channel.is_private)}`,
        `member=${Boolean(channel.is_member)}`,
        channel.topic?.value ? `topic=${channel.topic.value}` : undefined,
      ]
        .filter(Boolean)
        .join(" | "),
    )
    .join("\n");
}

function formatMessages(messages: SlackMessage[]): string {
  if (messages.length === 0) return "No Slack messages were found.";
  return messages.map(formatMessage).join("\n\n");
}

function formatSearchResults(results: Array<{ channel: SlackChannel; message: SlackMessage }>): string {
  if (results.length === 0) return "No matching recent Slack messages were found.";
  return results
    .map(result => {
      const channel = result.channel.name ? `#${result.channel.name}` : result.channel.id;
      return `Channel: ${channel}\n${formatMessage(result.message)}`;
    })
    .join("\n\n");
}

function formatMessage(message: SlackMessage): string {
  return [
    `TS: ${message.ts ?? "<missing>"}`,
    `User: ${message.user ?? message.username ?? message.bot_id ?? "<unknown>"}`,
    message.thread_ts ? `Thread: ${message.thread_ts}` : undefined,
    message.reply_count ? `Replies: ${message.reply_count}` : undefined,
    message.permalink ? `URL: ${message.permalink}` : undefined,
    `Text: ${message.text ?? ""}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatUsers(users: SlackUser[]): string {
  if (users.length === 0) return "No Slack users were found.";
  return users
    .map(user =>
      [
        `${user.id}`,
        user.name ? `name=${user.name}` : undefined,
        user.profile?.display_name ? `display=${user.profile.display_name}` : undefined,
        user.real_name ?? user.profile?.real_name
          ? `real=${user.real_name ?? user.profile?.real_name}`
          : undefined,
        user.profile?.email ? `email=${user.profile.email}` : undefined,
        `bot=${Boolean(user.is_bot)}`,
      ]
        .filter(Boolean)
        .join(" | "),
    )
    .join("\n");
}

function formatObject(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function toolTextResult(text: string, structuredContent: Record<string, unknown>): unknown {
  return {
    content: [{ type: "text", text }],
    structuredContent,
  };
}

function readToolParams(params: unknown): ToolCallParams {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new Error("tools/call params must be an object.");
  }
  return params as ToolCallParams;
}

function readString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map(entry => entry.trim());
}

function readOptionalNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.trunc(value), MAX_LIMIT));
}

function requestedProtocolVersion(params: unknown): string {
  if (!params || typeof params !== "object" || Array.isArray(params)) return "2024-11-05";
  const version = (params as { protocolVersion?: unknown }).protocolVersion;
  return typeof version === "string" && version ? version : "2024-11-05";
}

function writeResponse(id: JsonRpcId, result: unknown): void {
  writeJson({ jsonrpc: "2.0", id, result });
}

function writeError(id: JsonRpcId, code: number, message: string): void {
  writeJson({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  });
}

function writeJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
