import type OpenAI from "openai";
import * as weave from "weave";
import type { SubagentTask, Finding } from "./harness-types.js";

/**
 * Subagent: reads ONE document and extracts the facts relevant to the question + focus.
 * This is the unit fanned out in parallel by the harness. Fast model, short output.
 */

export interface SubagentDeps {
  client: OpenAI;
  model: string;
}

const SYSTEM =
  "You are a research subagent in a meeting assistant. From the provided document, extract ONLY " +
  "facts that help answer the question, guided by the focus. Be concise (1-3 sentences), quote " +
  "concrete details (names, dates, blockers). If the document is not relevant, reply with exactly: NONE.";

/**
 * Build a subagent. `deps` (incl. the OpenAI client) is captured in a CLOSURE — never passed as
 * a weave.op argument (Weave deep-serializes op args; the client is huge/circular). The returned
 * op takes only serializable data (question + task).
 */
export function createSubagent(deps: SubagentDeps) {
  return weave.op(
    async function subagent(question: string, task: SubagentTask): Promise<Finding> {
      const { doc, focus } = task;
      let summary = "";
      try {
        const res = await deps.client.chat.completions.create({
          model: deps.model,
          max_tokens: 220,
          messages: [
            { role: "system", content: SYSTEM },
            {
              role: "user",
              content:
                `Question: ${question}\nFocus: ${focus || "(general relevance)"}\n\n` +
                `Document [${doc.source}] "${doc.title}" (owner: ${doc.owner}):\n${doc.text}`,
            },
          ],
        });
        summary = (res.choices[0]?.message?.content ?? "").trim();
      } catch {
        summary = "";
      }

      // A subagent that finds nothing relevant returns an empty summary (filtered downstream).
      if (summary.toUpperCase() === "NONE") summary = "";

      return { docId: doc.id, title: doc.title, source: doc.source, owner: doc.owner, summary };
    },
    { name: "subagent" },
  );
}
