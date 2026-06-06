import type OpenAI from "openai";
import * as weave from "weave";
import { Memory } from "./memory.js";
import type { OutboundFrame } from "./protocol.js";
import { makeClient, FAST_MODEL, SMART_MODEL } from "./llm.js";

/**
 * The harness (board: "Live running, interactive agent that delegates to subagents",
 * "this layer owns the memory + harness").
 *
 * Shape: an Orchestrator decides which subagents to consult, runs the relevant ones,
 * then a Synthesizer streams the spoken answer. Each node is a Weave op, so the trace
 * renders as the delegation tree ctl/ can also show live via agentTrace frames. The LLM
 * calls themselves are traced too (the client is wrapped with weave.wrapOpenAI in llm.ts),
 * so each chat.completions span nests under its owning node.
 *
 * `emit` is how the harness pushes Outbound frames back to ctl/ (streaming text + traces).
 */

type Emit = (frame: OutboundFrame) => void;

export class Harness {
  private client: OpenAI;

  constructor(private memory: Memory) {
    this.client = makeClient();
  }

  /**
   * Handle one addressed utterance. Streams the answer out via `emit`.
   * correlationId/meetingId thread through so ctl/ can match the stream.
   */
  async handle(opts: {
    correlationId: string;
    meetingId: string;
    speaker: string;
    text: string;
    emit: Emit;
  }) {
    const { correlationId, meetingId, speaker, text, emit } = opts;
    const trace = (node: string, event: "start" | "finish", detail?: string) =>
      emit({ type: "agentTrace", correlationId, meetingId, node, event, detail });

    try {
      // 1) Orchestrator: decide what to consult.
      trace("orchestrator", "start");
      const plan = await this.orchestrate(text);
      trace("orchestrator", "finish", `consult: ${plan.consult.join(", ") || "none"}`);

      // 2) Subagents run for whatever the orchestrator asked for.
      const findings: string[] = [];
      const history = await this.memory.recentTurns(meetingId, 10);

      if (plan.consult.includes("memory") || plan.consult.includes("docs")) {
        trace("docs", "start");
        const chunks = await this.memory.retrieve(text, 4);
        trace("docs", "finish", `${chunks.length} chunks`);
        if (chunks.length) {
          findings.push(
            "Relevant company context:\n" +
              chunks
                .map((c) => `- [${c.doc.source}] ${c.doc.title} (owner: ${c.doc.owner}): ${c.doc.text}`)
                .join("\n")
          );
        }
      }

      if (plan.consult.includes("people")) {
        trace("people", "start");
        const note = await this.peopleSubagent(text);
        trace("people", "finish");
        if (note) findings.push(note);
      }

      // 3) Synthesizer: stream the spoken answer.
      trace("synth", "start");
      await this.synthesize({
        correlationId,
        meetingId,
        speaker,
        question: text,
        findings,
        history,
        emit,
      });
      trace("synth", "finish");
    } catch (err) {
      emit({
        type: "agentError",
        correlationId,
        meetingId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Orchestrator: a fast routing call that returns which subagents to run. */
  private orchestrate = weave.op(async (text: string): Promise<{ consult: string[] }> => {
    const res = await this.client.chat.completions.create({
      model: FAST_MODEL,
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            "You route a meeting assistant's work. Given the latest utterance, reply with ONLY " +
            'a JSON object: {"consult": [...]} where items are any of "docs" (company files/projects), ' +
            '"people" (who owns/knows something, who is absent), "memory" (recall earlier in meeting). ' +
            "No prose, no backticks.",
        },
        { role: "user", content: text },
      ],
    });
    const raw = res.choices[0]?.message?.content ?? "{}";
    try {
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      return { consult: Array.isArray(parsed.consult) ? parsed.consult : ["docs"] };
    } catch {
      return { consult: ["docs"] };
    }
  });

  /** People subagent: reasons about ownership/availability from retrieved context. */
  private peopleSubagent = weave.op(async (text: string): Promise<string> => {
    const chunks = await this.memory.retrieve(text, 4);
    if (!chunks.length) return "";
    const owners = [...new Set(chunks.map((c) => c.doc.owner))];
    return `Document/project owners relevant here: ${owners.join(", ")}. ` +
      `If the asker needs someone who is unavailable, surface the owning document's content directly.`;
  });

  /** Synthesizer: streams tokens out as agentMessage frames. */
  private synthesize = weave.op(
    async (opts: {
      correlationId: string;
      meetingId: string;
      speaker: string;
      question: string;
      findings: string[];
      history: { speaker: string; text: string }[];
      emit: Emit;
    }) => {
      const { correlationId, meetingId, speaker, question, findings, history, emit } = opts;
      const sys =
        "You are a meeting assistant speaking aloud in a live meeting. You hold company-wide " +
        "context. Answer the addressed person directly and concisely (2-4 sentences, spoken style). " +
        "Ground every claim in the provided context; if context is missing, say so plainly rather " +
        "than guessing. When the person needs a colleague who is unavailable, answer from that " +
        "colleague's documents instead of deferring.";
      const ctx =
        (history.length
          ? `Recent meeting turns:\n${history.map((h) => `${h.speaker}: ${h.text}`).join("\n")}\n\n`
          : "") +
        (findings.length ? `${findings.join("\n\n")}\n\n` : "Context: (none retrieved)\n\n");

      const stream = await this.client.chat.completions.create({
        model: SMART_MODEL,
        max_tokens: 400,
        stream: true,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `${ctx}${speaker} asks: ${question}` },
        ],
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          emit({ type: "agentMessage", correlationId, meetingId, delta, done: false });
        }
      }
      emit({ type: "agentMessage", correlationId, meetingId, delta: "", done: true });
    }
  );
}
