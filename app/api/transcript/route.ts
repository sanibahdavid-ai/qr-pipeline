import { NextRequest, NextResponse } from "next/server";
import { YoutubeTranscript } from "youtube-transcript";

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

function extractJsonBlock(html: string, key: string): Record<string, unknown> | null {
  const startIdx = html.indexOf(key);
  if (startIdx === -1) return null;
  const jsonStart = html.indexOf("{", startIdx);
  if (jsonStart === -1) return null;
  let depth = 0;
  for (let i = jsonStart; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(jsonStart, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

async function fetchTranscriptDirect(videoId: string): Promise<string> {
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Cookie": "CONSENT=YES+cb; SOCS=CAISHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzQaAmVuIAEaBgiA_LynBg",
    },
  });

  if (!pageRes.ok) throw new Error(`YouTube page: ${pageRes.status}`);

  const html = await pageRes.text();
  const player = extractJsonBlock(html, "ytInitialPlayerResponse");
  if (!player) throw new Error("No ytInitialPlayerResponse in page");

  type CaptionTrack = { languageCode: string; baseUrl: string };
  const tracks = (
    (player as Record<string, unknown>)?.captions as Record<string, unknown>
  )?.playerCaptionsTracklistRenderer as { captionTracks?: CaptionTrack[] } | undefined;

  const captionTracks = tracks?.captionTracks;
  if (!captionTracks?.length) throw new Error("No caption tracks");

  const track =
    captionTracks.find((t) => t.languageCode.startsWith("en")) ?? captionTracks[0];

  const captionRes = await fetch(`${track.baseUrl}&fmt=json3`);
  if (!captionRes.ok) throw new Error(`Caption fetch: ${captionRes.status}`);

  type CaptionEvent = { segs?: { utf8: string }[] };
  const captionData = await captionRes.json() as { events?: CaptionEvent[] };

  const text = (captionData.events ?? [])
    .flatMap((e) => e.segs ?? [])
    .map((s) => s.utf8.replace(/\n/g, " "))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) throw new Error("Empty transcript");
  return text;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.url) {
    return NextResponse.json({ error: "URL manquante" }, { status: 400 });
  }

  const videoId = extractVideoId(body.url);
  if (!videoId) {
    return NextResponse.json({ error: "URL YouTube invalide" }, { status: 400 });
  }

  let text: string | null = null;

  // Primary: youtube-transcript library
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    text = segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
    console.log("[transcript] library OK");
  } catch (err) {
    console.error("[transcript] library failed:", err instanceof Error ? err.message : err);
  }

  // Fallback: direct fetch with browser headers + consent cookie
  if (!text) {
    try {
      text = await fetchTranscriptDirect(videoId);
      console.log("[transcript] direct fetch OK");
    } catch (err) {
      console.error("[transcript] direct fetch failed:", err instanceof Error ? err.message : err);
    }
  }

  if (!text) {
    return NextResponse.json(
      { error: "Transcript indisponible pour cette vidéo." },
      { status: 422 }
    );
  }

  const title = await fetchVideoTitle(videoId);
  return NextResponse.json({ text, videoId, title });
}
