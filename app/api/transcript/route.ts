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
  console.log("[transcript:direct] fetching YouTube page for", videoId);

  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Cookie": "CONSENT=YES+cb; SOCS=CAISHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzQaAmVuIAEaBgiA_LynBg",
    },
  });

  console.log("[transcript:direct] YouTube page status:", pageRes.status, pageRes.statusText);
  if (!pageRes.ok) throw new Error(`YouTube page HTTP ${pageRes.status}`);

  const html = await pageRes.text();
  console.log("[transcript:direct] HTML length:", html.length);
  console.log("[transcript:direct] has ytInitialPlayerResponse:", html.includes("ytInitialPlayerResponse"));
  console.log("[transcript:direct] has playerCaptionsTracklistRenderer:", html.includes("playerCaptionsTracklistRenderer"));
  console.log("[transcript:direct] has captionTracks:", html.includes("captionTracks"));

  const player = extractJsonBlock(html, "ytInitialPlayerResponse");
  console.log("[transcript:direct] player parsed:", !!player);
  if (!player) throw new Error("No ytInitialPlayerResponse in page");

  type CaptionTrack = { languageCode: string; baseUrl: string };
  const captionsBlock = (player.captions as Record<string, unknown> | undefined);
  const renderer = captionsBlock?.playerCaptionsTracklistRenderer as { captionTracks?: CaptionTrack[] } | undefined;
  const captionTracks = renderer?.captionTracks;

  console.log("[transcript:direct] captionTracks count:", captionTracks?.length ?? 0);
  if (captionTracks?.length) {
    console.log("[transcript:direct] available langs:", captionTracks.map((t) => t.languageCode).join(", "));
  }

  if (!captionTracks?.length) throw new Error("No caption tracks in player response");

  const track = captionTracks.find((t) => t.languageCode.startsWith("en")) ?? captionTracks[0];
  console.log("[transcript:direct] selected track lang:", track.languageCode);
  console.log("[transcript:direct] caption URL (truncated):", track.baseUrl.slice(0, 80));

  const captionRes = await fetch(`${track.baseUrl}&fmt=json3`);
  console.log("[transcript:direct] caption fetch status:", captionRes.status);
  if (!captionRes.ok) throw new Error(`Caption fetch HTTP ${captionRes.status}`);

  type CaptionEvent = { segs?: { utf8: string }[] };
  const captionData = await captionRes.json() as { events?: CaptionEvent[] };
  const eventCount = captionData.events?.length ?? 0;
  console.log("[transcript:direct] caption events:", eventCount);

  const text = (captionData.events ?? [])
    .flatMap((e) => e.segs ?? [])
    .map((s) => s.utf8.replace(/\n/g, " "))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  console.log("[transcript:direct] text length:", text.length, "chars");
  if (!text) throw new Error("Empty transcript after parsing");
  return text;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  console.log("[transcript] POST received, url:", body?.url ?? "none");

  if (!body?.url) {
    return NextResponse.json({ error: "URL manquante" }, { status: 400 });
  }

  const videoId = extractVideoId(body.url);
  console.log("[transcript] videoId:", videoId);
  if (!videoId) {
    return NextResponse.json({ error: "URL YouTube invalide" }, { status: 400 });
  }

  let text: string | null = null;

  // Primary: youtube-transcript library
  console.log("[transcript] trying youtube-transcript library...");
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    text = segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
    console.log("[transcript] library OK, chars:", text.length);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[transcript] library FAILED:", msg);
  }

  // Fallback: direct fetch with browser headers + consent cookie
  if (!text) {
    console.log("[transcript] trying direct fetch fallback...");
    try {
      text = await fetchTranscriptDirect(videoId);
      console.log("[transcript] direct fetch OK, chars:", text.length);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[transcript] direct fetch FAILED:", msg);
    }
  }

  if (!text) {
    console.error("[transcript] all methods failed for", videoId);
    return NextResponse.json(
      { error: "Transcript indisponible pour cette vidéo." },
      { status: 422 }
    );
  }

  const title = await fetchVideoTitle(videoId);
  console.log("[transcript] success, title:", title);
  return NextResponse.json({ text, videoId, title });
}
