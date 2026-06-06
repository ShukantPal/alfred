import type OpenAI from "openai";
import { Memory } from "./memory.js";
import type { OutboundFrame } from "./protocol.js";
import { makeClient, FAST_MODEL, SMART_MODEL } from "./llm.js";
import { createPlanner } from "./planner.js";
import { createSubagent } from "./subagent.js";
import { createSynthesizer } from "./synthesizer.js";
import type { Finding, SubagentTask } from "./harness-types.js";

/**
 * The harness (board: "Live running, interactive agent that delegates to subagents").
 *
 * Flow per addressed utterance:
 *   retrieve candidates -> planner picks docs -> fan out subagents IN PARALLEL -> synthesize
 *   a streamed, grounded answer. Optionally emits agentAction{presentUrl} when present-mode is on.
 *
 * Every stage is a weave.op (so the Weave trace renders as the delegation tree) and emits a
 * matching agentTrace frame so ctl/ can mirror the tree live.
 */

type Emit = (frame: OutboundFrame) => void;

export interface HarnessOptions {
  /** When true, also emit agentAction{presentUrl} for the planner's chosen doc. */
  presentMode?: boolean;
  /** Max subagents running concurrently (keeps latency + API load sane). */
  maxConcurrency?: number;
  /** How many candidate docs to retrieve for the planner catalog. */
  candidateCount?: number;
  /** Injectable for tests; defaults to the configured W&B/OpenAI client. */
  client?: OpenAI;
  fastModel?: string;
  smartModel?: string;
}

export class Harness {
  private presentMode: boolean;
  private maxConcurrency: number;
  private candidateCount: number;
  private planner: ReturnType<typeof createPlanner>;
  private subagent: ReturnType<typeof createSubagent>;
  private synthesizer: ReturnType<typeof createSynthesizer>;

  constructor(private memory: Memory, options: HarnessOptions = {}) {
    const client: OpenAI = options.client ?? makeClient();
    const fastModel = options.fastModel ?? FAST_MODEL;
    const smartModel = options.smartModel ?? SMART_MODEL;
    this.presentMode = options.presentMode ?? false;
    this.maxConcurrency = options.maxConcurrency ?? 5;
    this.candidateCount = options.candidateCount ?? 8;
    this.planner = createPlanner({ client, model: fastModel });
    this.subagent = createSubagent({ client, model: fastModel });
    this.synthesizer = createSynthesizer({ client, model: smartModel });
  }

  async handle(opts: {
    correlationId: string;
    meetingId: string;
    speaker: string;
    text: string;
    emit: Emit;
  }): Promise<void> {
    const { correlationId, meetingId, speaker, text, emit } = opts;
    const trace = (node: string, event: "start" | "finish", detail?: string) =>
      emit({ type: "agentTrace", correlationId, meetingId, node, event, detail });

    try {
      const history = await this.memory.recentTurns(meetingId, 10);

      // 1) Retrieve candidate docs for the planner's catalog.
      trace("retrieve", "start");
      const candidates = await this.memory.retrieve(text, this.candidateCount);
      trace("retrieve", "finish", `${candidates.length} candidates`);

      // 2) Plan: which docs to fan out on (+ optional present doc).
      trace("planner", "start");
      const built = await this.planner(
        text,
        candidates.map(c => c.doc),
        { presentMode: this.presentMode },
      );
      trace("planner", "finish", `${built.tasks.length} subagents${built.present ? ` · present ${built.present.docId}` : ""}`);

      // 3) Fan out subagents in parallel (concurrency-capped).
      const findings = await this.fanOut(text, built.tasks, trace);

      // 4) Optionally present the chosen doc (before/while speaking).
      if (this.presentMode && built.present) {
        const doc = candidates.find(c => c.doc.id === built.present!.docId)?.doc;
        if (doc?.url) {
          emit({
            type: "agentAction",
            correlationId,
            meetingId,
            action: { kind: "presentUrl", url: doc.url, title: doc.title },
            requiresConfirmation: true,
          });
        }
      }

      // 5) Synthesize the streamed answer.
      trace("synth", "start");
      await this.synthesizer({
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

  /** Run subagent tasks in parallel with a concurrency cap; failed tasks are dropped. */
  private async fanOut(
    question: string,
    tasks: SubagentTask[],
    trace: (node: string, event: "start" | "finish", detail?: string) => void,
  ): Promise<Finding[]> {
    const findings: Finding[] = [];
    let cursor = 0;

    const worker = async () => {
      while (cursor < tasks.length) {
        const task = tasks[cursor++]!;
        const node = `subagent:${task.doc.id}`;
        trace(node, "start", task.focus || undefined);
        try {
          const finding = await this.subagent(question, task);
          findings.push(finding);
          trace(node, "finish", finding.summary ? "found" : "nothing relevant");
        } catch {
          trace(node, "finish", "error");
        }
      }
    };

    const lanes = Math.min(this.maxConcurrency, Math.max(1, tasks.length));
    await Promise.all(Array.from({ length: lanes }, () => worker()));
    return findings;
  }
}
