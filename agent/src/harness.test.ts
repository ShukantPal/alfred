import { describe, it, expect } from "vitest";
import type OpenAI from "openai";
import { Harness } from "./harness.js";
import { Memory } from "./memory.js";
import type { ContextDoc } from "./memory.js";
import type { OutboundFrame } from "./protocol.js";

const docs: ContextDoc[] = [
  { id: "doc-a", source: "slack", title: "Deploys", owner: "Priya", text: "do not ship yet", url: "https://x/a" },
  { id: "doc-b", source: "gdoc", title: "Onboarding", owner: "Priya", text: "5 to 3 steps", url: "https://x/b" },
];

/** Fake Memory exposing only what the harness uses. */
const fakeMemory = {
  retrieve: async () => docs.map((doc, i) => ({ doc, score: 10 - i })),
  recentTurns: async () => [] as { speaker: string; text: string }[],
} as unknown as Memory;

/** Fake OpenAI: planner -> JSON, subagent -> summary, synth (stream) -> two deltas. */
function fakeClient(): OpenAI {
  return {
    chat: {
      completions: {
        create: async (args: any) => {
          if (args.stream) {
            return (async function* () {
              yield { choices: [{ delta: { content: "It is " } }] };
              yield { choices: [{ delta: { content: "not safe to ship." } }] };
            })();
          }
          const sys: string = args.messages?.[0]?.content ?? "";
          if (sys.includes("plan")) {
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      investigate: [
                        { id: "doc-a", focus: "safe to ship?" },
                        { id: "doc-b", focus: "what changed?" },
                      ],
                      present: "doc-a",
                    }),
                  },
                },
              ],
            };
          }
          return { choices: [{ message: { content: "a relevant fact" } }] };
        },
      },
    },
  } as unknown as OpenAI;
}

async function run(presentMode: boolean): Promise<OutboundFrame[]> {
  const frames: OutboundFrame[] = [];
  const harness = new Harness(fakeMemory, {
    client: fakeClient(),
    presentMode,
    fastModel: "fast",
    smartModel: "smart",
  });
  await harness.handle({
    correlationId: "c1",
    meetingId: "m1",
    speaker: "Zain",
    text: "Can the onboarding redesign ship to prod?",
    emit: f => frames.push(f),
  });
  return frames;
}

describe("Harness.handle (fan-out)", () => {
  it("emits the delegation tree: retrieve, planner, a subagent per task, synth", async () => {
    const frames = await run(false);
    const nodes = frames
      .filter((f): f is Extract<OutboundFrame, { type: "agentTrace" }> => f.type === "agentTrace")
      .map(f => `${f.node}:${f.event}`);

    expect(nodes).toContain("retrieve:start");
    expect(nodes).toContain("planner:finish");
    expect(nodes).toContain("subagent:doc-a:start");
    expect(nodes).toContain("subagent:doc-b:finish");
    expect(nodes).toContain("synth:finish");
  });

  it("streams the answer and terminates with done", async () => {
    const frames = await run(false);
    const messages = frames.filter(
      (f): f is Extract<OutboundFrame, { type: "agentMessage" }> => f.type === "agentMessage",
    );
    const text = messages.map(m => m.delta).join("");
    expect(text).toBe("It is not safe to ship.");
    expect(messages.at(-1)!.done).toBe(true);
  });

  it("does NOT present when present-mode is off", async () => {
    const frames = await run(false);
    expect(frames.some(f => f.type === "agentAction")).toBe(false);
  });

  it("emits agentAction{presentUrl} when present-mode is on", async () => {
    const frames = await run(true);
    const action = frames.find(
      (f): f is Extract<OutboundFrame, { type: "agentAction" }> => f.type === "agentAction",
    );
    expect(action).toBeDefined();
    expect(action!.action).toEqual({ kind: "presentUrl", url: "https://x/a", title: "Deploys" });
    expect(action!.requiresConfirmation).toBe(true);
  });
});
