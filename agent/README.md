# agent/ — Alfred Talon Delegate

`agent/` configures Alfred's Talon-backed company-memory delegate. It no longer
owns a bespoke planner, subagent fanout harness, Redis store, or WebSocket RPC
server.

`ctl/` still owns meeting I/O and OpenAI Realtime voice. When the Realtime model
calls `delegate_to_company_agent`, ctl uses this package to create or reuse a
meeting-scoped Talon session. Talon owns the delegated agent runtime. Company
memory is attached by default through a local stdio MCP server in `agent/`, so no
port is needed. `TALON_COMPANY_MCP_URL` or `REDIS_MCP_URL` can still override it
with an external HTTP MCP endpoint.

**For AI coding tools and full system context, read [AGENTS.md](../AGENTS.md).**

## Quick start
```bash
bun install
export OPENAI_API_KEY=...
bun run agent:dev
```

`agent:dev` starts a local Talon node, configures the `company-memory` agent, and
attaches the built-in stdio company-memory MCP server. `agent:demo` starts the
same Talon runtime, asks a sample question, prints the answer, and exits.

Use `agent:test` to exercise the same delegate path ctl uses:

```bash
bun run agent:test -- --question "Is the onboarding redesign safe to ship?"
bun run agent:test -- --meeting-id local-debug --repeat 3
bun run agent:test -- --interactive
```

## Environment

- `OPENAI_API_KEY`: required; used by default for the Talon OpenAI-compatible provider.
- `WANDB_API_KEY`: required; enables Weave tracing and is used for W&B Inference when `LLM_PROVIDER=wandb`.
- `WEAVE_PROJECT`: Weave project name, default `meeting-agent`.
- `LLM_PROVIDER`: `openai` or `wandb` for the Talon delegate provider config, default `openai`.
- `TALON_NAMESPACE`: Talon namespace, default `alfred`.
- `TALON_COMPANY_AGENT`: agent name, default `company-memory`.
- `TALON_PROVIDER_NAME`: provider key configured in Talon, default `openai`.
- `TALON_PROVIDER_BASE_URL`: OpenAI-compatible provider base URL; defaults to OpenAI or W&B Inference based on `LLM_PROVIDER`.
- `TALON_MODEL`: delegate model, default `gpt-4.1-mini` for OpenAI or `ibm-granite/granite-4.1-8b` for W&B Inference.
- `TALON_DATA_DIR`: persistent Talon control-plane data directory, default `.tools/talon/data`.
- `TALON_WORKSPACE_DIR`: Talon workspace directory, default `.tools/talon/workspace`.
- `TALON_JWT_SECRET`: required local Talon JWT secret.
- `TALON_JWT_TTL_SECONDS`: TTL for freshly minted Talon request JWTs, default `86400`. Alfred mints a new token for each Talon RPC.
- `TALON_COMPANY_MCP_NAME`: MCP server name in Talon, default `company-memory`.
- `TALON_COMPANY_MCP_URL`: optional HTTP MCP endpoint for Redis/company-memory tools. When unset, agent uses the built-in stdio MCP server.
- `REDIS_MCP_URL`: fallback HTTP MCP URL when `TALON_COMPANY_MCP_URL` is unset.
- `TALON_MEMORY_MCP_COMMAND`: command for the built-in stdio MCP server, default is the current Bun executable.
- `TALON_MEMORY_MCP_ARGS_JSON`: JSON string array of stdio MCP command args, default points at `agent/src/memory-mcp.ts`.
- `TALON_COMPANY_MCP_HEADERS_JSON`: optional JSON object of MCP headers.
- `TALON_DELEGATE_TIMEOUT_MS`: delegation timeout, default `20000`.

## Files
| File | Role |
|---|---|
| `src/talon.ts` | Starts Talon, configures MCP + agent, sends messages |
| `src/memory-mcp.ts` | Built-in stdio MCP server for seeded company memory |
| `src/company-memory.ts` | Seeded company context used by the MCP server |
| `src/types.ts` | Delegate interface used by ctl |
| `src/server.ts` | Long-running Talon bootstrap process |
| `src/demo-client.ts` | One-shot Talon delegation demo |
