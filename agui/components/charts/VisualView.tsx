"use client";

import { useEffect, useId, useRef } from "react";
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
import type {
  VisualChartSpec,
  VisualMermaidSpec,
  VisualQuoteSpec,
  VisualSpec,
  VisualTableSpec,
  VisualTextSpec,
} from "@/lib/visual";

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
    case "quote":
      return <QuoteVisual spec={spec} />;
    case "mermaid":
      return <MermaidVisual spec={spec} />;
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

function MermaidVisual({ spec }: { spec: VisualMermaidSpec }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderId = useId().replace(/:/g, "");

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !spec.diagram.trim()) return;

    let cancelled = false;
    container.replaceChildren();

    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "neutral",
          securityLevel: "loose",
          fontFamily: "inherit",
        });
        if (cancelled) return;
        const { svg } = await mermaid.render(`alfred-mermaid-${renderId}`, spec.diagram.trim());
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = svg;
      } catch {
        if (!cancelled && containerRef.current) {
          containerRef.current.textContent = "Could not render this diagram.";
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [renderId, spec.diagram]);

  return (
    <>
      <VisualHeader title={spec.title} subtitle={spec.subtitle} />
      <div className="chat-visual__mermaid" ref={containerRef} />
    </>
  );
}

function QuoteVisual({ spec }: { spec: VisualQuoteSpec }) {
  const githubLabel = githubSourceLabel(spec.source, spec.url);

  return (
    <>
      <VisualHeader title={spec.title} />
      <blockquote className="chat-visual__quote">
        <span className="chat-visual__quote-mark" aria-hidden>
          “
        </span>
        <p className="chat-visual__quote-text">{spec.text}</p>
        <footer className="chat-visual__quote-footer">
          <cite className="chat-visual__quote-attribution">{spec.attribution}</cite>
          {githubLabel ? (
            <a
              className="chat-visual__quote-github"
              href={spec.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <GithubIcon />
              <span>{githubLabel}</span>
            </a>
          ) : spec.url ? (
            <a
              className="chat-visual__quote-source-link"
              href={spec.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {spec.source ?? spec.url}
            </a>
          ) : spec.source ? (
            <span className="chat-visual__quote-source">{spec.source}</span>
          ) : null}
        </footer>
      </blockquote>
    </>
  );
}

function isGithubUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname === "github.com";
  } catch {
    return false;
  }
}

function githubSourceLabel(source: string | undefined, url: string | undefined): string | undefined {
  if (!isGithubUrl(url)) return undefined;
  const parsed = new URL(url!);
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return source ?? "GitHub";
  const repo = `${parts[0]}/${parts[1]}`;
  const fileIndex = parts[2] === "blob" || parts[2] === "tree" ? 3 : 2;
  const filePath = parts.slice(fileIndex).join("/");
  if (filePath) return `${repo} · ${filePath}`;
  return source ?? repo;
}

function GithubIcon() {
  return (
    <svg
      className="chat-visual__quote-github-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  );
}
