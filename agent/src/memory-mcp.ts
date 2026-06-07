import { createInterface } from "node:readline";
import {
  COMPANY_MEMORY_DOCS,
  getCompanyMemoryDoc,
  searchCompanyMemory,
  type CompanyMemoryDoc,
  type CompanyMemoryResult,
} from "./company-memory";

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

const SERVER_INFO = {
  name: "alfred-company-memory",
  version: "0.1.0",
};

const tools = [
  {
    name: "company_memory_search",
    description:
      "Search Alfred's seeded company memory across Google Docs, Slack, project, and Drive context.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural-language query or keywords to search for.",
        },
        limit: {
          type: "number",
          description: "Maximum number of matching context documents to return.",
          minimum: 1,
          maximum: 20,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "company_memory_get",
    description: "Fetch a specific company-memory document by id.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Company-memory document id.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "company_memory_list",
    description: "List available company-memory document summaries.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of document summaries to return.",
          minimum: 1,
          maximum: 20,
        },
      },
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

  if (request.id === undefined) {
    return;
  }

  try {
    const result = handleRequest(request);
    writeResponse(request.id, result);
  } catch (error) {
    writeError(request.id, -32603, error instanceof Error ? error.message : String(error));
  }
}

function handleRequest(request: JsonRpcRequest): unknown {
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

function callTool(params: ToolCallParams): unknown {
  const args = params.arguments ?? {};
  switch (params.name) {
    case "company_memory_search": {
      const query = readString(args.query, "query");
      const results = searchCompanyMemory(query, readOptionalNumber(args.limit, 5));
      return toolTextResult(formatSearchResults(results), { results });
    }
    case "company_memory_get": {
      const id = readString(args.id, "id");
      const doc = getCompanyMemoryDoc(id);
      if (!doc) {
        return {
          content: [{ type: "text", text: `No company-memory document found for id ${id}.` }],
          isError: true,
        };
      }
      return toolTextResult(formatDoc(doc), { doc });
    }
    case "company_memory_list": {
      const limit = readOptionalNumber(args.limit, 20);
      const docs = COMPANY_MEMORY_DOCS.slice(0, limit).map(summaryDoc);
      return toolTextResult(formatDocList(docs), { docs });
    }
    default:
      throw new Error(`Unknown company-memory tool: ${params.name ?? "<missing>"}`);
  }
}

function formatSearchResults(results: CompanyMemoryResult[]): string {
  if (results.length === 0) return "No matching company-memory context was found.";
  return results.map(formatDoc).join("\n\n");
}

function formatDoc(doc: CompanyMemoryDoc | CompanyMemoryResult): string {
  const score = "score" in doc ? `\nScore: ${doc.score}` : "";
  const lines = [
    `ID: ${doc.id}`,
    `Source: ${doc.source}`,
    `Title: ${doc.title}`,
    `Owner: ${doc.owner}`,
    `URL: ${doc.url}${score}`,
    `Text: ${doc.text}`,
  ];
  // Surface any structured payload as exact JSON so the agent can chart/table it.
  if (doc.data) {
    lines.push(`Data (JSON): ${JSON.stringify(doc.data)}`);
  }
  return lines.join("\n");
}

function formatDocList(docs: Array<ReturnType<typeof summaryDoc>>): string {
  if (docs.length === 0) return "No company-memory documents are available.";
  return docs.map(doc => `${doc.id} | ${doc.source} | ${doc.owner} | ${doc.title}`).join("\n");
}

function summaryDoc(doc: CompanyMemoryDoc): Omit<CompanyMemoryDoc, "text" | "data"> {
  const { text: _text, data: _data, ...summary } = doc;
  return summary;
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

function readOptionalNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.trunc(value), 20));
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
