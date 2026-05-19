import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "DAV Pipeline",
  description: "Made by Dav",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={GeistSans.variable} suppressHydrationWarning>
      <body>
        {children}
        <Toaster
          position="top-right"
          theme="dark"
          toastOptions={{
            style: {
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              background: "#141414",
              border: "1px solid #262626",
              color: "#F5F5F5",
            },
          }}
        />
      </body>
    </html>
  );
}
