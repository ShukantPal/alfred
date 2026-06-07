"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { VisualChartSpec, VisualSpec, VisualTableSpec, VisualTextSpec } from "@/lib/visual";

// Alfred-chosen generative UI. Rendered inside the screenshare chat view from a
// VisualSpec the Talon delegate produced. Recharts handles the chart kinds; tables
// and text fall back to plain markup. This component is purely presentational —
// CopilotKit's render tool decides when to mount it.

const CHART_COLORS = [
  "#111827",
  "#2563eb",
  "#0d9488",
  "#d97706",
  "#9333ea",
  "#dc2626",
  "#65a30d",
  "#0891b2",
];

export function VisualView({ spec }: { spec: VisualSpec }) {
  return <figure className="chat-visual">{renderSpec(spec)}</figure>;
}

function renderSpec(spec: VisualSpec) {
  switch (spec.kind) {
    case "pie":
    case "bar":
    case "line":
      return <ChartVisual spec={spec} />;
    case "table":
      return <TableVisual spec={spec} />;
    case "text":
    default:
      return <TextVisual spec={spec} />;
  }
}

function VisualHeader({ title, subtitle }: { title?: string; subtitle?: string }) {
  if (!title && !subtitle) return null;
  return (
    <figcaption className="chat-visual__header">
      {title ? <span className="chat-visual__title">{title}</span> : null}
      {subtitle ? <span className="chat-visual__subtitle">{subtitle}</span> : null}
    </figcaption>
  );
}

function formatValue(value: number, unit?: string): string {
  const compact = Math.abs(value) >= 1000
    ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  if (!unit) return compact;
  // Symbol-like units sit in front; word-like units sit behind.
  return /^[$£€¥]/.test(unit) ? `${unit}${compact}` : `${compact}${unit}`;
}

function ChartVisual({ spec }: { spec: VisualChartSpec }) {
  const tooltipFormatter = (value: unknown) =>
    typeof value === "number" ? formatValue(value, spec.unit) : String(value ?? "");
  const axisFormatter = (value: unknown) =>
    typeof value === "number" ? formatValue(value, spec.unit) : String(value ?? "");

  return (
    <>
      <VisualHeader title={spec.title} subtitle={spec.subtitle} />
      <div className="chat-visual__chart">
        <ResponsiveContainer width="100%" height="100%">
          {spec.kind === "pie" ? (
            <PieChart>
              <Pie
                data={spec.series}
                dataKey="value"
                nameKey="label"
                innerRadius="45%"
                outerRadius="80%"
                paddingAngle={2}
              >
                {spec.series.map((point, index) => (
                  <Cell key={point.label} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={tooltipFormatter} />
              <Legend />
            </PieChart>
          ) : spec.kind === "bar" ? (
            <BarChart data={spec.series} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={axisFormatter} width={56} />
              <Tooltip formatter={tooltipFormatter} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {spec.series.map((point, index) => (
                  <Cell key={point.label} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <LineChart data={spec.series} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={axisFormatter} width={56} />
              <Tooltip formatter={tooltipFormatter} />
              <Line type="monotone" dataKey="value" stroke={CHART_COLORS[1]} strokeWidth={2} dot />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </>
  );
}

function TableVisual({ spec }: { spec: VisualTableSpec }) {
  return (
    <>
      <VisualHeader title={spec.title} subtitle={spec.subtitle} />
      <div className="chat-visual__table-wrap">
        <table className="chat-visual__table">
          <thead>
            <tr>
              {spec.columns.map(column => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TextVisual({ spec }: { spec: VisualTextSpec }) {
  return (
    <>
      <VisualHeader title={spec.title} />
      <p className="chat-visual__text">{spec.text}</p>
    </>
  );
}
