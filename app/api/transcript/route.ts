import { NextRequest, NextResponse } from "next/server";

type Platform = "youtube" | "tiktok" | "instagram";

function detectPlatform(url: string): Platform | null {
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  if (/tiktok\.com/.test(url)) return "tiktok";
  if (/instagram\.com/.test(url)) return "instagram";
  return null;
}

function extractVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

async function fetchVideoTitle(videoId: string): Promise<string> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (!res.ok) return videoId;
    const data = await res.json();
    return (data as { title?: string }).title ?? videoId;
  } catch {
    return videoId;
  }
}

type SupadataResponse = {
  content?: string;
  lang?: string;
  availableLangs?: string[];
  jobId?: string;
  status?: string;
  result?: { content?: string };
};

async function supadataCall(url: string, mode: "native" | "generate" | "auto", apiKey: string) {
  const params = new URLSearchParams({ url, text: "true", mode });
  return fetch(`https://api.supadata.ai/v1/transcript?${params}`, {
    headers: { "x-api-key": apiKey },
  });
}

async function pollJob(jobId: string, apiKey: string): Promise<{ content: string; lang?: string } | null> {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const res = await fetch(`https://api.supadata.ai/v1/transcript/${jobId}`, {
      headers: { "x-api-key": apiKey },
    });
    if (!res.ok) continue;
    const data = (await res.json()) as SupadataResponse;
    if (data.status === "completed" && data.result?.content) {
      return { content: data.result.content };
    }
    if (data.status === "failed") return null;
  }
  return null;
}

async function fetchTranscriptContent(url: string, apiKey: string): Promise<{ content: string; lang?: string }> {
  // Try native captions first (1 credit), fallback to AI generation (2 credits/min)
  let res = await supadataCall(url, "native", apiKey);
  console.log("[transcript] native status:", res.status);

  // 206 = no native captions available
  if (res.status === 206 || res.status === 404) {
    console.log("[transcript] no native captions, trying AI generation");
    res = await supadataCall(url, "generate", apiKey);
    console.log("[transcript] generate status:", res.status);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("[transcript] Supadata error:", res.status, errBody.slice(0, 200));
    throw new Error("Transcript indisponible pour cette vidéo.");
  }

  const data = (await res.json()) as SupadataResponse;

  // Async job (HTTP 202)
  if (data.jobId) {
    console.log("[transcript] async job started:", data.jobId);
    const result = await pollJob(data.jobId, apiKey);
    if (!result) throw new Error("Traitement trop long. Réessaie dans quelques minutes.");
    return result;
  }

  const content = data.content?.trim();
  if (!content) throw new Error("Transcript vide pour cette vidéo.");
  return { content, lang: data.lang };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  console.log("[transcript] POST received, url:", body?.url ?? "none");

  if (!body?.url) {
    return NextResponse.json({ error: "URL manquante" }, { status: 400 });
  }

  const platform = detectPlatform(body.url);
  console.log("[transcript] platform:", platform);

  if (!platform) {
    return NextResponse.json(
      { error: "URL non supportée. Colle un lien YouTube, TikTok ou Instagram." },
      { status: 400 }
    );
  }

  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) {
    console.error("[transcript] SUPADATA_API_KEY missing");
    return NextResponse.json({ error: "Configuration serveur manquante" }, { status: 500 });
  }

  try {
    const { content, lang } = await fetchTranscriptContent(body.url, apiKey);

    // Fetch title for YouTube only (oEmbed doesn't support TikTok/Instagram)
    let title = "";
    if (platform === "youtube") {
      const videoId = extractVideoId(body.url);
      if (videoId) title = await fetchVideoTitle(videoId);
    }
    if (!title) {
      // Generic title fallback
      title = platform === "tiktok" ? "Vidéo TikTok" : platform === "instagram" ? "Vidéo Instagram" : "Vidéo YouTube";
    }

    console.log("[transcript] success, title:", title, "chars:", content.length, "lang:", lang);
    return NextResponse.json({ text: content, title, platform, lang });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[transcript] error:", msg);
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
