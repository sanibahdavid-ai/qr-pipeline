import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return Response.json({ error: "Missing url" }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Response.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (parsed.protocol !== "https:") {
    return Response.json({ error: "Only HTTPS URLs allowed" }, { status: 400 });
  }
  const blocked = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
  if (blocked.includes(parsed.hostname) || parsed.hostname.endsWith(".local")) {
    return Response.json({ error: "URL not allowed" }, { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: { "xi-api-key": process.env.MINIMAX_API_KEY ?? "" },
    });
    if (!res.ok) {
      return Response.json({ error: `Upstream error: ${res.status}` }, { status: 502 });
    }
    const buffer = await res.arrayBuffer();
    return new Response(buffer, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "audio/mpeg",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return Response.json({ error: "Fetch failed" }, { status: 500 });
  }
}
