import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alfred Console",
  description: "Operator console for the Alfred meeting bot",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
