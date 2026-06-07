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

interface GitHubRepo {
  full_name?: string;
  name?: string;
  default_branch?: string;
  private?: boolean;
  html_url?: string;
  description?: string | null;
}

interface GitHubFile {
  type?: string;
  name?: string;
  path?: string;
  download_url?: string | null;
  content?: string;
  encoding?: string;
  html_url?: string;
}

interface GitHubIssue {
  number?: number;
  title?: string;
  state?: string;
  html_url?: string;
  user?: { login?: string };
  pull_request?: unknown;
  body?: string | null;
}

interface GitHubPullRequest {
  number?: number;
  title?: string;
  state?: string;
  html_url?: string;
  user?: { login?: string };
  head?: { ref?: string; sha?: string };
  base?: { ref?: string };
  body?: string | null;
}

interface GitHubCommit {
  sha?: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: { name?: string; date?: string };
  };
}

const SERVER_INFO = {
  name: "alfred-github",
  version: "0.1.0",
};

const MAX_LIMIT = 100;

const tools = [
  {
    name: "github_get_repository",
    description: "Get read-only metadata for a GitHub repository.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Repository owner." },
        repo: { type: "string", description: "Repository name." },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "github_get_file_contents",
    description: "Get the contents of a file from a GitHub repository.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Repository owner." },
        repo: { type: "string", description: "Repository name." },
        path: { type: "string", description: "File path, for example README.md." },
        ref: { type: "string", description: "Optional branch, tag, or commit SHA." },
      },
      required: ["owner", "repo", "path"],
    },
  },
  {
    name: "github_list_issues",
    description: "List repository issues. Pull requests are excluded.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        state: { type: "string", enum: ["open", "closed", "all"], default: "open" },
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "github_get_issue",
    description: "Get a repository issue by number.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        number: { type: "number" },
      },
      required: ["owner", "repo", "number"],
    },
  },
  {
    name: "github_list_pull_requests",
    description: "List repository pull requests.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        state: { type: "string", enum: ["open", "closed", "all"], default: "open" },
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "github_get_pull_request",
    description: "Get a repository pull request by number.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        number: { type: "number" },
      },
      required: ["owner", "repo", "number"],
    },
  },
  {
    name: "github_list_commits",
    description: "List recent repository commits.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        sha: { type: "string", description: "Optional branch, tag, or commit SHA." },
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
      },
      required: ["owner", "repo"],
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
        capabilities: { tools: {} },
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
    case "github_get_repository": {
      const repo = await githubApi<GitHubRepo>(
        `/repos/${readString(args.owner, "owner")}/${readString(args.repo, "repo")}`,
      );
      return toolTextResult(formatRepo(repo), { repository: repo });
    }
    case "github_get_file_contents": {
      const owner = readString(args.owner, "owner");
      const repo = readString(args.repo, "repo");
      const path = readString(args.path, "path").replace(/^\/+/, "");
      const ref = readOptionalString(args.ref);
      const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      const file = await githubApi<GitHubFile>(`/repos/${owner}/${repo}/contents/${path}${query}`);
      const text = decodeFile(file);
      return toolTextResult(formatFile(file, text), { file: { ...file, decodedContent: text } });
    }
    case "github_list_issues": {
      const issues = await githubApi<GitHubIssue[]>(
        `/repos/${readString(args.owner, "owner")}/${readString(args.repo, "repo")}/issues?state=${readState(args.state)}&per_page=${readOptionalNumber(args.limit, 30)}`,
      );
      const filtered = issues.filter(issue => !issue.pull_request);
      return toolTextResult(formatIssues(filtered), { issues: filtered });
    }
    case "github_get_issue": {
      const issue = await githubApi<GitHubIssue>(
        `/repos/${readString(args.owner, "owner")}/${readString(args.repo, "repo")}/issues/${readNumber(args.number, "number")}`,
      );
      return toolTextResult(formatIssue(issue), { issue });
    }
    case "github_list_pull_requests": {
      const prs = await githubApi<GitHubPullRequest[]>(
        `/repos/${readString(args.owner, "owner")}/${readString(args.repo, "repo")}/pulls?state=${readState(args.state)}&per_page=${readOptionalNumber(args.limit, 30)}`,
      );
      return toolTextResult(formatPullRequests(prs), { pullRequests: prs });
    }
    case "github_get_pull_request": {
      const pr = await githubApi<GitHubPullRequest>(
        `/repos/${readString(args.owner, "owner")}/${readString(args.repo, "repo")}/pulls/${readNumber(args.number, "number")}`,
      );
      return toolTextResult(formatPullRequest(pr), { pullRequest: pr });
    }
    case "github_list_commits": {
      const sha = readOptionalString(args.sha);
      const shaQuery = sha ? `&sha=${encodeURIComponent(sha)}` : "";
      const commits = await githubApi<GitHubCommit[]>(
        `/repos/${readString(args.owner, "owner")}/${readString(args.repo, "repo")}/commits?per_page=${readOptionalNumber(args.limit, 20)}${shaQuery}`,
      );
      return toolTextResult(formatCommits(commits), { commits });
    }
    default:
      throw new Error(`Unknown GitHub tool: ${params.name ?? "<missing>"}`);
  }
}

async function githubApi<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${githubToken()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "alfred-github-mcp",
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "message" in data
        ? String((data as { message?: unknown }).message)
        : `${response.status} ${response.statusText}`;
    throw new Error(`GitHub API ${path} failed: ${message}`);
  }
  return data as T;
}

function githubToken(): string {
  const token =
    process.env.TALON_GITHUB_MCP_AUTH_TOKEN?.trim() ||
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN?.trim() ||
    process.env.GITHUB_PAT?.trim();
  if (!token) {
    throw new Error("Set TALON_GITHUB_MCP_AUTH_TOKEN, GITHUB_PERSONAL_ACCESS_TOKEN, or GITHUB_PAT.");
  }
  return token;
}

function decodeFile(file: GitHubFile): string {
  if (file.type !== "file") throw new Error(`${file.path ?? file.name ?? "path"} is not a file.`);
  if (file.encoding !== "base64" || !file.content) return "";
  return Buffer.from(file.content.replace(/\s+/g, ""), "base64").toString("utf8");
}

function formatRepo(repo: GitHubRepo): string {
  return [
    `Repository: ${repo.full_name ?? repo.name ?? "<unknown>"}`,
    `Default branch: ${repo.default_branch ?? "<unknown>"}`,
    `Private: ${Boolean(repo.private)}`,
    repo.html_url ? `URL: ${repo.html_url}` : undefined,
    repo.description ? `Description: ${repo.description}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatFile(file: GitHubFile, text: string): string {
  return [
    `File: ${file.path ?? file.name ?? "<unknown>"}`,
    file.html_url ? `URL: ${file.html_url}` : undefined,
    "Content:",
    text.slice(0, 20_000),
  ]
    .filter(Boolean)
    .join("\n");
}

function formatIssues(issues: GitHubIssue[]): string {
  if (issues.length === 0) return "No GitHub issues found.";
  return issues.map(formatIssue).join("\n\n");
}

function formatIssue(issue: GitHubIssue): string {
  return [
    `Issue #${issue.number}: ${issue.title ?? "<untitled>"}`,
    `State: ${issue.state ?? "<unknown>"}`,
    `Author: ${issue.user?.login ?? "<unknown>"}`,
    issue.html_url ? `URL: ${issue.html_url}` : undefined,
    issue.body ? `Body: ${issue.body.slice(0, 4000)}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatPullRequests(prs: GitHubPullRequest[]): string {
  if (prs.length === 0) return "No GitHub pull requests found.";
  return prs.map(formatPullRequest).join("\n\n");
}

function formatPullRequest(pr: GitHubPullRequest): string {
  return [
    `PR #${pr.number}: ${pr.title ?? "<untitled>"}`,
    `State: ${pr.state ?? "<unknown>"}`,
    `Author: ${pr.user?.login ?? "<unknown>"}`,
    pr.base?.ref || pr.head?.ref ? `Branch: ${pr.head?.ref ?? "?"} -> ${pr.base?.ref ?? "?"}` : undefined,
    pr.html_url ? `URL: ${pr.html_url}` : undefined,
    pr.body ? `Body: ${pr.body.slice(0, 4000)}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatCommits(commits: GitHubCommit[]): string {
  if (commits.length === 0) return "No GitHub commits found.";
  return commits
    .map(commit =>
      [
        `Commit: ${commit.sha ?? "<unknown>"}`,
        `Author: ${commit.commit?.author?.name ?? "<unknown>"}`,
        `Date: ${commit.commit?.author?.date ?? "<unknown>"}`,
        commit.html_url ? `URL: ${commit.html_url}` : undefined,
        `Message: ${commit.commit?.message ?? ""}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
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

function readNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a number.`);
  }
  return Math.trunc(value);
}

function readOptionalNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.trunc(value), MAX_LIMIT));
}

function readState(value: unknown): string {
  return value === "closed" || value === "all" ? value : "open";
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
    error: { code, message },
  });
}

function writeJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
