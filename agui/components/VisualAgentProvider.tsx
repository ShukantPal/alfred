"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAgent, useCopilotKit, useRenderTool } from "@copilotkit/react-core/v2";
import { VisualView } from "@/components/charts/VisualView";
import { RENDER_CHART_TOOL } from "@/lib/talonVisualAgent";
import { toVisualSpec, visualSpecSchema, type VisualSpec, type VisualSpecParams } from "@/lib/visual";

// The screenshare's bridge to the headless CopilotKit/AG-UI client. Talon decides
// the visual (via ctl -> buildVisual, surfaced by the alfred-visual AG-UI agent);
// CopilotKit streams a `render_chart` tool call which we surface here. `ask` runs
// the agent programmatically so the meeting participant never types.

export interface VisualItem {
  id: string;
  spec: VisualSpec;
  /** First-seen time (epoch ms) so visuals can interleave with chat messages. */
  ts: number;
}

interface VisualAgentValue {
  visuals: VisualItem[];
  /** `afterTs` slots the chart after the user prompt + waveform in the chat timeline. */
  ask(question: string, afterTs?: number): void;
}

const VisualAgentContext = createContext<VisualAgentValue | null>(null);

/** Visuals + the programmatic `ask`. Safe no-op default outside the provider. */
export function useVisualAgent(): VisualAgentValue {
  return useContext(VisualAgentContext) ?? EMPTY_VALUE;
}

const EMPTY_VALUE: VisualAgentValue = { visuals: [], ask: () => {} };

export function VisualAgentProvider({ children }: { children: ReactNode }) {
  const { agent } = useAgent({ agentId: "alfred-visual" });
  const { copilotkit } = useCopilotKit();
  const [mounted, setMounted] = useState(false);

  // Canonical generative-UI binding: any CopilotKit chat surface would render the
  // chart from this. The screenshare is headless, so we also read the agent's
  // messages below to place the chart inside our own ChatMode layout.
  useRenderTool({
    name: RENDER_CHART_TOOL,
    parameters: visualSpecSchema,
    render: props => <VisualView spec={toVisualSpec(props.parameters as VisualSpecParams)} />,
  });

  // Stamp each visual with the time it first appeared so ChatMode can order it
  // against chat bubbles. The agent's tool-call messages carry no timestamp, so we
  // record first-seen client time per visual id (stable across re-renders).
  const seenAtRef = useRef<Map<string, number>>(new Map());
  const minVisualTsRef = useRef<number | undefined>(undefined);
  const visuals = mounted
    ? extractVisuals(agent.messages, seenAtRef.current, minVisualTsRef.current)
    : [];

  useEffect(() => {
    setMounted(true);
  }, []);

  const ask = useCallback(
    (question: string, afterTs?: number) => {
      const trimmed = question.trim();
      if (!trimmed) return;
      if (typeof afterTs === "number" && Number.isFinite(afterTs)) {
        minVisualTsRef.current = afterTs;
      }
      agent.addMessage({ id: crypto.randomUUID(), role: "user", content: trimmed });
      void copilotkit.runAgent({ agent });
    },
    [agent, copilotkit],
  );

  const value = useMemo<VisualAgentValue>(
    () => ({ visuals, ask }),
    // `visuals` is recomputed each render from the (mutable) agent message list;
    // key the memo on its contents so consumers update when a new chart arrives.
    [ask, serializeVisualIds(visuals)],
  );

  return <VisualAgentContext.Provider value={value}>{children}</VisualAgentContext.Provider>;
}

function serializeVisualIds(visuals: VisualItem[]): string {
  return visuals.map(item => item.id).join("|");
}

interface ToolCallMessage {
  role?: string;
  toolCalls?: Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

function extractVisuals(
  messages: readonly unknown[],
  seenAt: Map<string, number>,
  minTs?: number,
): VisualItem[] {
  const items: VisualItem[] = [];
  for (const raw of messages) {
    const message = raw as ToolCallMessage;
    if (message.role !== "assistant" || !Array.isArray(message.toolCalls)) continue;
    for (const call of message.toolCalls) {
      if (call.type !== "function" || call.function?.name !== RENDER_CHART_TOOL) continue;
      const id = call.id;
      const spec = parseSpecArguments(call.function?.arguments);
      if (!id || !spec) continue;
      let ts = seenAt.get(id);
      if (ts === undefined) {
        ts = Math.max(Date.now(), minTs ?? 0);
        seenAt.set(id, ts);
      }
      items.push({ id, spec, ts });
    }
  }
  return items;
}

function parseSpecArguments(args: string | undefined): VisualSpec | undefined {
  if (!args || !args.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    return undefined;
  }
  const result = visualSpecSchema.safeParse(parsed);
  if (!result.success) return undefined;
  return toVisualSpec(result.data);
}
