import { z } from "zod";

// Mirror of the VisualSpec contract in agent/src/types.ts. agui is a standalone
// Next app (not a workspace member), so the shape is duplicated here. The `kind`
// field is the discriminant the chart renderer switches on; Alfred (Talon) decides
// which kind best represents the answer.

export type VisualKind = "pie" | "bar" | "line" | "table" | "text" | "quote";

export interface VisualPoint {
  label: string;
  value: number;
}

export interface VisualChartSpec {
  kind: "pie" | "bar" | "line";
  title: string;
  subtitle?: string;
  unit?: string;
  series: VisualPoint[];
}

export interface VisualTableSpec {
  kind: "table";
  title: string;
  subtitle?: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}

export interface VisualTextSpec {
  kind: "text";
  title?: string;
  text: string;
}

export interface VisualQuoteSpec {
  kind: "quote";
  text: string;
  attribution: string;
  source?: string;
  url?: string;
  title?: string;
}

export type VisualSpec = VisualChartSpec | VisualTableSpec | VisualTextSpec | VisualQuoteSpec;

const pointSchema = z.object({
  label: z.string(),
  value: z.number(),
});

// Zod schema for CopilotKit's `useRenderTool` parameters. The agent calls
// `render_chart` with a VisualSpec-shaped argument; this validates/types the props.
export const visualSpecSchema = z.object({
  kind: z.enum(["pie", "bar", "line", "table", "text", "quote"]),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  unit: z.string().optional(),
  series: z.array(pointSchema).optional(),
  columns: z.array(z.string()).optional(),
  rows: z.array(z.array(z.union([z.string(), z.number()]))).optional(),
  text: z.string().optional(),
  attribution: z.string().optional(),
  source: z.string().optional(),
  url: z.string().optional(),
});

export type VisualSpecParams = z.infer<typeof visualSpecSchema>;

/** Narrow a loosely-typed params object (from the tool call) into a VisualSpec. */
export function toVisualSpec(params: VisualSpecParams): VisualSpec {
  switch (params.kind) {
    case "pie":
    case "bar":
    case "line":
      return {
        kind: params.kind,
        title: params.title ?? "Untitled",
        subtitle: params.subtitle,
        unit: params.unit,
        series: params.series ?? [],
      };
    case "table":
      return {
        kind: "table",
        title: params.title ?? "Untitled",
        subtitle: params.subtitle,
        columns: params.columns ?? [],
        rows: params.rows ?? [],
      };
    case "quote":
      return {
        kind: "quote",
        title: params.title,
        text: params.text ?? "",
        attribution: params.attribution ?? "Unknown",
        source: params.source,
        url: params.url,
      };
    case "text":
    default:
      return {
        kind: "text",
        title: params.title,
        text: params.text ?? "",
      };
  }
}
