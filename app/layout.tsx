import type { Metadata } from "next";
import { Syne, Space_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const syne = Syne({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-syne",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DAV Pipeline",
  description: "Made by Dav",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${syne.variable} ${spaceMono.variable}`} suppressHydrationWarning>
      <body>
        {children}
        <Toaster
          position="top-right"
          theme="dark"
          toastOptions={{
            style: {
              fontFamily: "var(--font-space-mono), monospace",
              fontSize: "12px",
              background: "#0d1512",
              border: "1px solid #1a2e25",
              color: "#e0f0e8",
            },
          }}
        />
      </body>
    </html>
  );
}
