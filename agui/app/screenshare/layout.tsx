import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Alfred",
  description: "Alfred live meeting workspace",
};

export default function ScreenshareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
