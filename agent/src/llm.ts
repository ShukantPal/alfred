import OpenAI from "openai";
import { wrapOpenAI } from "weave";

/**
 * LLM provider for the agent layer. One OpenAI-compatible client, switchable between
 * Weights & Biases Inference and OpenAI, traced by Weave from the get-go.
 *
 * Why OpenAI-compatible: W&B Inference exposes the exact OpenAI Chat Completions API at a
 * different base URL, so a single client + `wrapOpenAI` covers both providers and both get
 * Weave traces (every chat.completions.create becomes a span nested under our weave.op nodes).
 *
 * Auth note for WeaveHacks: with provider=wandb the SAME W&B API key powers BOTH inference and
 * Weave tracing — set WANDB_API_KEY once and everything lights up.
 */

export type Provider = "wandb" | "openai";

const WANDB_BASE_URL = "https://api.inference.wandb.ai/v1";

/** Sensible per-provider defaults; override any of them via env (see below). */
const DEFAULTS: Record<Provider, { baseURL?: string; fast: string; smart: string }> = {
  // W&B Inference (default): matched Qwen3 *Instruct* (non-thinking) pair — strong tool-calling
  // + agentic reasoning at low latency, ideal for a meeting brain that fans out to subagents and
  // calls tools (Drive, present). FAST = 3B-active worker; SMART = flagship synth/action-decider.
  // Swap SMART to "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8" if tool-calling proves flaky.
  wandb: {
    baseURL: WANDB_BASE_URL,
    fast: "Qwen/Qwen3-30B-A3B-Instruct-2507",
    smart: "Qwen/Qwen3-235B-A22B-Instruct-2507",
  },
  // OpenAI proper: keep the small model for routing, the flagship for synthesis.
  openai: { baseURL: undefined, fast: "gpt-4o-mini", smart: "gpt-4o" },
};

function resolveProvider(): Provider {
  const explicit = process.env.LLM_PROVIDER?.toLowerCase();
  if (explicit === "wandb" || explicit === "openai") return explicit;
  // Auto-detect: prefer W&B when only a W&B key is present, else OpenAI.
  if (process.env.WANDB_API_KEY && !process.env.OPENAI_API_KEY) return "wandb";
  if (process.env.OPENAI_API_KEY && !process.env.WANDB_API_KEY) return "openai";
  return "wandb"; // WeaveHacks default
}

export const PROVIDER: Provider = resolveProvider();

const defaults = DEFAULTS[PROVIDER];

/** Routing/subagents: cheap + fast. Override with FAST_MODEL. */
export const FAST_MODEL = process.env.FAST_MODEL ?? defaults.fast;
/** Synthesis: best quality answer. Override with SMART_MODEL. */
export const SMART_MODEL = process.env.SMART_MODEL ?? defaults.smart;

function apiKey(): string {
  const key =
    PROVIDER === "wandb"
      ? process.env.WANDB_API_KEY ?? process.env.OPENAI_API_KEY
      : process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      `[llm] No API key for provider "${PROVIDER}". Set ${
        PROVIDER === "wandb" ? "WANDB_API_KEY" : "OPENAI_API_KEY"
      } in your environment (.env).`
    );
  }
  return key;
}

/**
 * The shared, Weave-wrapped chat client. `project` (W&B team/project) is optional and only
 * used for usage tracking on W&B Inference; it does not affect Weave tracing.
 */
export function makeClient(): OpenAI {
  const client = new OpenAI({
    apiKey: apiKey(),
    baseURL: process.env.LLM_BASE_URL ?? defaults.baseURL,
    ...(PROVIDER === "wandb" && process.env.WANDB_INFERENCE_PROJECT
      ? { project: process.env.WANDB_INFERENCE_PROJECT }
      : {}),
  });
  // Cast bridges a stale type in weave@0.7.5 (its wrapOpenAI generic targets the older OpenAI
  // SDK shape with `beta.chat.completions.parse`, relocated in openai@6). Runtime patching of
  // chat.completions.create — what we use — is unaffected.
  return wrapOpenAI(client as never) as OpenAI;
}
