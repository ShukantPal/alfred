import type OpenAI from "openai";
import * as weave from "weave";
import type { OutboundFrame } from "./protocol.js";
import type { Finding } from "./harness-types.js";

/**
 * Synthesizer: merge the subagents' findings + recent meeting turns into the spoken answer,
 * streamed token-by-token as agentMessage frames. Smart model, grounded, concise.
 */

type Emit = (frame: OutboundFrame) => void;

export interface SynthesizerDeps {
  client: OpenAI;
  model: string;
}

export interface SynthesizeOptions {
  correlationId: string;
  meetingId: string;
  speaker: string;
  question: string;
  findings: Finding[];
  history: { speaker: string; text: string }[];
  emit: Emit;
}

const SYSTEM =
  "You are Alfred, a helpful assistant speaking aloud in a live company meeting. Converse " +
  "naturally and warmly, like a knowledgeable colleague — you can handle small talk, follow-ups, " +
  "and general questions using your own knowledge. You ALSO hold company-wide context gathered by " +
  "your research subagents, provided below as findings. Guidelines: " +
  "(1) For company-specific questions, ground your answer in the findings; if the findings don't " +
  "cover a company fact, say you don't have that on record rather than inventing it. " +
  "(2) For general questions or chit-chat, just answer naturally from your own knowledge — do not " +
  "claim a lack of company context when none is needed. " +
  "(3) When someone needs a colleague who is unavailable, answer from that colleague's documents " +
  "instead of deferring. " +
  "Keep replies concise and spoken (2-4 sentences).";

/** Render the subagent findings into the context block the synthesizer reads. */
export function renderFindings(findings: Finding[]): string {
  const useful = findings.filter(f => f.summary.trim());
  if (useful.length === 0) return "Findings: (none relevant retrieved)";
  return (
    "Findings from subagents:\n" +
    useful
      .map(f => `- [${f.source}] ${f.title} (owner: ${f.owner}): ${f.summary}`)
      .join("\n")
  );
}

/**
 * Build the synthesizer. `deps` (incl. the OpenAI client) is captured in a CLOSURE — never an
 * op argument (Weave deep-serializes op args; the client is huge/circular). The op's args are
 * the per-request serializable data plus `emit` (a function, which Weave skips safely).
 */
export function createSynthesizer(deps: SynthesizerDeps) {
  return weave.op(
    async function synth(options: SynthesizeOptions): Promise<void> {
      const { correlationId, meetingId, speaker, question, findings, history, emit } = options;

      const historyBlock = history.length
        ? `Recent meeting turns:\n${history.map(h => `${h.speaker}: ${h.text}`).join("\n")}\n\n`
        : "";
      const context = `${historyBlock}${renderFindings(findings)}\n\n`;

      const stream = await deps.client.chat.completions.create({
        model: deps.model,
        max_tokens: 400,
        stream: true,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `${context}${speaker} asks: ${question}` },
        ],
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          emit({ type: "agentMessage", correlationId, meetingId, delta, done: false });
        }
      }
      emit({ type: "agentMessage", correlationId, meetingId, delta: "", done: true });
    },
    { name: "synthesizer" },
  );
}
