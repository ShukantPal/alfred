"use client";

import { useEffect, useState, type ReactNode } from "react";

/** Mount children only after hydration — for third-party UI that is not SSR-safe. */
export function ClientOnly({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return children;
}
