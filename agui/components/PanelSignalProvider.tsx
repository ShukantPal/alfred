"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PanelSignalEvent, PanelTarget } from "@/lib/panel";

interface PanelSignalContextValue {
  /** The rows currently lit up (what Alfred touched for the latest prompt). */
  highlighted: ReadonlySet<PanelTarget>;
  applySignal(event: PanelSignalEvent): void;
}

const PanelSignalContext = createContext<PanelSignalContextValue | null>(null);

export function usePanelSignals(): PanelSignalContextValue {
  const value = useContext(PanelSignalContext);
  if (!value) {
    throw new Error("usePanelSignals must be used within PanelSignalProvider");
  }
  return value;
}

export function PanelSignalProvider({ children }: { children: ReactNode }) {
  const [highlighted, setHighlighted] = useState<ReadonlySet<PanelTarget>>(
    () => new Set<PanelTarget>(),
  );

  const applySignal = useCallback((event: PanelSignalEvent) => {
    setHighlighted(current => {
      if (event.op === "clear") {
        return current.size === 0 ? current : new Set<PanelTarget>();
      }
      if (current.has(event.target)) return current;
      const next = new Set(current);
      next.add(event.target);
      return next;
    });
  }, []);

  const value = useMemo<PanelSignalContextValue>(
    () => ({ highlighted, applySignal }),
    [highlighted, applySignal],
  );

  return (
    <PanelSignalContext.Provider value={value}>{children}</PanelSignalContext.Provider>
  );
}
