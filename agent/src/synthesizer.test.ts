import { describe, it, expect } from "vitest";
import { renderFindings } from "./synthesizer.js";
import type { Finding } from "./harness-types.js";

const finding = (over: Partial<Finding>): Finding => ({
  docId: "d",
  title: "Doc",
  source: "gdoc",
  owner: "Priya",
  summary: "",
  ...over,
});

describe("renderFindings", () => {
  it("lists only findings that have a non-empty summary", () => {
    const out = renderFindings([
      finding({ title: "A", summary: "do not ship" }),
      finding({ title: "B", summary: "" }),
    ]);
    expect(out).toContain("A");
    expect(out).toContain("do not ship");
    expect(out).not.toContain("B");
  });

  it("states none-retrieved when every summary is empty", () => {
    const out = renderFindings([finding({ summary: "" }), finding({ summary: "   " })]);
    expect(out.toLowerCase()).toContain("none");
  });
});
