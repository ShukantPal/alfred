import { describe, it, expect } from "vitest";
import { parsePlannerResponse } from "./planner.js";
import type { ContextDoc } from "./memory.js";

const candidates: ContextDoc[] = [
  { id: "doc-a", source: "gdoc", title: "Onboarding", owner: "Priya", text: "..." },
  { id: "doc-b", source: "slack", title: "Deploys", owner: "Priya", text: "..." },
  { id: "doc-c", source: "drive", title: "Brand", owner: "Lena", text: "..." },
];

describe("parsePlannerResponse", () => {
  it("parses a valid plan and maps ids to docs", () => {
    const raw = JSON.stringify({
      investigate: [
        { id: "doc-a", focus: "is it safe to ship?" },
        { id: "doc-b", focus: "any deploy blockers?" },
      ],
    });
    const plan = parsePlannerResponse(raw, candidates, false);
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0]!.doc.id).toBe("doc-a");
    expect(plan.tasks[0]!.focus).toContain("safe to ship");
    expect(plan.present).toBeUndefined();
  });

  it("strips code fences", () => {
    const raw = "```json\n" + JSON.stringify({ investigate: [{ id: "doc-c", focus: "colors" }] }) + "\n```";
    const plan = parsePlannerResponse(raw, candidates, false);
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]!.doc.id).toBe("doc-c");
  });

  it("ignores ids not present in the candidate catalog", () => {
    const raw = JSON.stringify({
      investigate: [
        { id: "doc-a", focus: "x" },
        { id: "ghost", focus: "y" },
      ],
    });
    const plan = parsePlannerResponse(raw, candidates, false);
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]!.doc.id).toBe("doc-a");
  });

  it("returns empty tasks on malformed JSON (caller applies fallback)", () => {
    const plan = parsePlannerResponse("not json at all", candidates, false);
    expect(plan.tasks).toHaveLength(0);
    expect(plan.present).toBeUndefined();
  });

  it("includes present only when presentMode is on and id is in catalog", () => {
    const raw = JSON.stringify({
      investigate: [{ id: "doc-a", focus: "x" }],
      present: "doc-c",
    });
    expect(parsePlannerResponse(raw, candidates, false).present).toBeUndefined();
    expect(parsePlannerResponse(raw, candidates, true).present).toEqual({ docId: "doc-c" });
  });

  it("drops present when the chosen id is not a candidate", () => {
    const raw = JSON.stringify({ investigate: [{ id: "doc-a", focus: "x" }], present: "ghost" });
    expect(parsePlannerResponse(raw, candidates, true).present).toBeUndefined();
  });

  it("defaults focus to the empty string when omitted", () => {
    const raw = JSON.stringify({ investigate: [{ id: "doc-b" }] });
    const plan = parsePlannerResponse(raw, candidates, false);
    expect(plan.tasks[0]!.focus).toBe("");
  });
});
