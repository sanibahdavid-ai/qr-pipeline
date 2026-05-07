import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QR Pipeline",
  description: "YouTube → Transcript → QR Script → Voice",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
