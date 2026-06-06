import type { ContextDoc } from "./memory.js";

/**
 * Shared types for the fan-out delegation harness.
 *
 * planner -> { tasks: SubagentTask[], present? } -> parallel subagents -> Finding[] -> synth.
 */

/** One unit of fan-out: a subagent reads `doc` to answer the question through `focus`. */
export interface SubagentTask {
  doc: ContextDoc;
  /** A focused angle/sub-question the planner wants this doc investigated for. */
  focus: string;
}

/** The doc the planner chose to put on screen (only used when present-mode is on). */
export interface PresentChoice {
  docId: string;
}

/** Planner output: which docs to fan out on, and optionally one to present. */
export interface Plan {
  tasks: SubagentTask[];
  present?: PresentChoice;
}

/** A subagent's focused extraction from one document. */
export interface Finding {
  docId: string;
  title: string;
  source: ContextDoc["source"];
  owner: string;
  /** Facts extracted from the doc that bear on the question (may be empty if irrelevant). */
  summary: string;
}
