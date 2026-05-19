import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DAV Pipeline",
  description: "Made by Dav",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
