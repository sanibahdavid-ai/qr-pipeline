import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
// Polices auto-hébergées (aucune dépendance à Google Fonts au build)
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow/700.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "DAV Pipeline",
  description: "Made by Dav",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0a1322",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body>
        {children}
        <Toaster
          position="top-center"
          theme="dark"
          toastOptions={{
            style: {
              fontFamily: "Barlow, sans-serif",
              fontSize: "14px",
              background: "#16243b",
              border: "1px solid #22365a",
              color: "#eef3fb",
              borderRadius: "14px",
            },
          }}
        />
      </body>
    </html>
  );
}
