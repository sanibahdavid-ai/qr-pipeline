import type { NextConfig } from "next";

const FLASK_URL = "http://localhost:5757";

const nextConfig: NextConfig = {
  serverExternalPackages: ['edge-tts-universal'],

  async rewrites() {
    // Proxy Flask routes through Next.js so both share one public port.
    // Flask routes don't overlap with any Next.js page or /api/* route.
    return [
      { source: "/app",             destination: `${FLASK_URL}/app` },
      { source: "/ping",            destination: `${FLASK_URL}/ping` },
      { source: "/download",        destination: `${FLASK_URL}/download` },
      { source: "/download-stream", destination: `${FLASK_URL}/download-stream` },
      { source: "/history",         destination: `${FLASK_URL}/history` },
      { source: "/open-folder",     destination: `${FLASK_URL}/open-folder` },
    ];
  },
};

export default nextConfig;
