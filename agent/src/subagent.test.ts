import { describe, it, expect } from "vitest";
import type OpenAI from "openai";
import { createSubagent } from "./subagent.js";
import type { SubagentTask } from "./harness-types.js";

const task: SubagentTask = {
  doc: { id: "doc-a", source: "slack", title: "Deploys", owner: "Priya", text: "do not ship yet" },
  focus: "is it safe to ship?",
};

function fakeClient(content: string | (() => never)): OpenAI {
  return {
    chat: {
      completions: {
        create: async () => {
          if (typeof content === "function") content();
          return { choices: [{ message: { content } }] };
        },
      },
    },
  } as unknown as OpenAI;
}

describe("createSubagent", () => {
  it("returns a well-formed Finding carrying doc metadata + model summary", async () => {
    const run = createSubagent({
      client: fakeClient("Priya says do not ship until the race is fixed."),
      model: "fast",
    });
    const finding = await run("can we ship?", task);
    expect(finding.docId).toBe("doc-a");
    expect(finding.source).toBe("slack");
    expect(finding.owner).toBe("Priya");
    expect(finding.summary).toContain("do not ship");
  });

  it("maps a NONE answer to an empty summary", async () => {
    const run = createSubagent({ client: fakeClient("NONE"), model: "fast" });
    const finding = await run("unrelated?", task);
    expect(finding.summary).toBe("");
  });

  it("tolerates a model error by returning an empty summary", async () => {
    const run = createSubagent({
      client: fakeClient(() => {
        throw new Error("boom");
      }),
      model: "fast",
    });
    const finding = await run("x", task);
    expect(finding.summary).toBe("");
    expect(finding.docId).toBe("doc-a");
  });
});
