import type { NextConfig } from "next";

const FLASK_URL = "http://localhost:5757";
const CSP_URL = "http://localhost:8010";

const nextConfig: NextConfig = {
  serverExternalPackages: ['edge-tts-universal'],

  async rewrites() {
    // Proxy Flask routes through Next.js so both share one public port.
    // Flask routes don't overlap with any Next.js page or /api/* route.
    return [
      { source: "/app",                    destination: `${FLASK_URL}/app` },
      { source: "/ping",                   destination: `${FLASK_URL}/ping` },
      { source: "/download",               destination: `${FLASK_URL}/download` },
      { source: "/download-stream",        destination: `${FLASK_URL}/download-stream` },
      { source: "/history",                destination: `${FLASK_URL}/history` },
      { source: "/open-folder",            destination: `${FLASK_URL}/open-folder` },
      { source: "/stream-download",        destination: `${FLASK_URL}/stream-download` },
      { source: "/redirect/:token",        destination: `${FLASK_URL}/redirect/:token` },
      { source: "/test-r2",               destination: `${FLASK_URL}/test-r2` },
      { source: "/transcript-ytdlp",        destination: `${FLASK_URL}/transcript` },
      { source: "/transcript-whisper",      destination: `${FLASK_URL}/transcript-whisper` },
      // Clone Script Pipeline — point d'accès caché, pas de lien visible dans le nav.
      { source: "/csp",                     destination: `${CSP_URL}/` },
      { source: "/csp/:path*",              destination: `${CSP_URL}/:path*` },
    ];
  },
};

export default nextConfig;
