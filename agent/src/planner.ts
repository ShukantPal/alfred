import type OpenAI from "openai";
import * as weave from "weave";
import type { ContextDoc } from "./memory.js";
import type { Plan, SubagentTask } from "./harness-types.js";

/**
 * Planner: given the question and a catalog of candidate documents, decide which docs to fan
 * out subagents on (and, when present-mode is on, which one to put on screen).
 *
 * The LLM call is separated from the pure `parsePlannerResponse` so the parsing/validation
 * logic is unit-testable without the network.
 */

export interface PlannerDeps {
  client: OpenAI;
  model: string;
}

export interface PlanOptions {
  presentMode: boolean;
  /** How many candidates to fall back to if the planner returns nothing usable. */
  fallbackCount?: number;
}

const SYSTEM =
  "You plan a meeting assistant's research. You are given the latest question and a CATALOG of " +
  "candidate company documents (id, source, owner, title, snippet). Pick ONLY the documents " +
  "worth reading to answer the question, and for each give a short 'focus' (what to look for). " +
  "If asked, also choose ONE document to present on screen. Reply with ONLY this JSON, no prose, " +
  'no backticks: {"investigate":[{"id":"<docId>","focus":"<what to look for>"}],"present":"<docId or omit>"}';

/** Build the catalog block the planner sees (snippet kept short to stay fast/cheap). */
function renderCatalog(candidates: ContextDoc[]): string {
  return candidates
    .map(
      d =>
        `- id=${d.id} [${d.source}] owner=${d.owner} title="${d.title}" snippet="${d.text.slice(0, 160)}"`,
    )
    .join("\n");
}

/** Pure parser/validator for the planner's JSON response. No network, fully testable. */
export function parsePlannerResponse(
  raw: string,
  candidates: ContextDoc[],
  presentMode: boolean,
): Plan {
  const byId = new Map(candidates.map(d => [d.id, d]));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    return { tasks: [] };
  }

  if (!parsed || typeof parsed !== "object") return { tasks: [] };
  const obj = parsed as Record<string, unknown>;

  const tasks: SubagentTask[] = [];
  if (Array.isArray(obj.investigate)) {
    for (const item of obj.investigate) {
      if (!item || typeof item !== "object") continue;
      const { id, focus } = item as Record<string, unknown>;
      const doc = typeof id === "string" ? byId.get(id) : undefined;
      if (!doc) continue;
      tasks.push({ doc, focus: typeof focus === "string" ? focus : "" });
    }
  }

  const plan: Plan = { tasks };

  if (presentMode && typeof obj.present === "string" && byId.has(obj.present)) {
    plan.present = { docId: obj.present };
  }

  return plan;
}

/**
 * Build the planner. `deps` (incl. the OpenAI client) is captured in a CLOSURE — never passed
 * as a weave.op argument — because Weave deep-serializes op args and the client object is huge
 * and circular (would blow the stack). The returned op takes only serializable data.
 *
 * Falls back to the top-N candidates (so we always investigate something) when the model
 * returns no usable tasks.
 */
export function createPlanner(deps: PlannerDeps) {
  return weave.op(
    async function planner(
      question: string,
      candidates: ContextDoc[],
      options: PlanOptions,
    ): Promise<Plan> {
      if (candidates.length === 0) return { tasks: [] };

      let raw = "{}";
      try {
        const res = await deps.client.chat.completions.create({
          model: deps.model,
          max_tokens: 400,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: `Question: ${question}\n\nCATALOG:\n${renderCatalog(candidates)}` },
          ],
        });
        raw = res.choices[0]?.message?.content ?? "{}";
      } catch {
        // fall through to fallback
      }

      const parsed = parsePlannerResponse(raw, candidates, options.presentMode);
      if (parsed.tasks.length > 0) return parsed;

      // Fallback: investigate the top candidates with a generic focus.
      const fallbackCount = options.fallbackCount ?? 3;
      return {
        tasks: candidates.slice(0, fallbackCount).map(doc => ({ doc, focus: question })),
        present: parsed.present,
      };
    },
    { name: "planner" },
  );
}
