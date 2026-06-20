import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

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

// ── Supadata ──────────────────────────────────────────────────────────────────

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

async function fetchTranscriptViaSupadata(url: string, apiKey: string): Promise<{ content: string; lang?: string }> {
  let res = await supadataCall(url, "native", apiKey);
  console.log("[transcript] supadata native:", res.status);

  if (res.status === 206 || res.status === 404) {
    res = await supadataCall(url, "generate", apiKey);
    console.log("[transcript] supadata generate:", res.status);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`supadata:${res.status}:${body.slice(0, 120)}`);
  }

  const data = (await res.json()) as SupadataResponse;

  if (data.jobId) {
    const result = await pollJob(data.jobId, apiKey);
    if (!result) throw new Error("supadata:job_failed");
    return result;
  }

  const content = data.content?.trim();
  if (!content) throw new Error("supadata:empty");
  return { content, lang: data.lang };
}

// ── Fallback 1: yt-dlp via Flask ─────────────────────────────────────────────

async function fetchTranscriptViaYtDlp(url: string): Promise<{ content: string; lang?: string }> {
  const flaskUrl = process.env.FLASK_INTERNAL_URL ?? "http://localhost:5757";
  console.log("[transcript] yt-dlp fallback →", flaskUrl);
  const res = await fetch(`${flaskUrl}/transcript`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "yt-dlp error" })) as { error?: string };
    throw new Error(err.error ?? "yt-dlp: transcript unavailable");
  }
  const data = (await res.json()) as { content?: string; lang?: string };
  if (!data.content) throw new Error("yt-dlp: empty transcript");
  return { content: data.content, lang: data.lang };
}

// ── Fallback 3: yt-dlp audio → HuggingFace Whisper (works for any video) ─────

async function fetchTranscriptViaWhisper(url: string): Promise<{ content: string; lang?: string }> {
  const flaskUrl = process.env.FLASK_INTERNAL_URL ?? "http://localhost:5757";
  console.log("[transcript] whisper fallback →", flaskUrl);
  const res = await fetch(`${flaskUrl}/transcript-whisper`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    // Whisper can take ~40s on cold start; rely on Render's connection timeout
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "whisper error" })) as { error?: string };
    throw new Error(err.error ?? "whisper: transcription failed");
  }
  const data = (await res.json()) as { content?: string; lang?: string };
  if (!data.content) throw new Error("whisper: empty transcript");
  return { content: data.content, lang: data.lang ?? "en" };
}

// ── Fallback 2: YouTube page → captionTracks → timedtext XML ─────────────────

type CaptionTrack = { languageCode: string; baseUrl: string; kind?: string };

/**
 * Scan `str` starting at `start` (must be `{` or `[`) and return the index of
 * the matching closing delimiter, properly skipping over JSON strings.
 */
function findJsonEnd(str: string, start: number): number {
  const open  = str[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr  = false;
  let esc    = false;
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (esc)            { esc = false; continue; }
    if (c === "\\" && inStr) { esc = true;  continue; }
    if (c === '"')      { inStr = !inStr;   continue; }
    if (inStr)          { continue; }
    if (c === open)     { depth++;  }
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&apos;/g, "'");
}

async function fetchTranscriptViaYouTubePage(url: string): Promise<{ content: string; lang?: string }> {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error("YouTube video ID not found");

  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      // bypass EU consent gate
      "Cookie":          "CONSENT=YES+cb; SOCS=CAI",
    },
  });
  if (!pageRes.ok) throw new Error(`YouTube page returned ${pageRes.status}`);
  const html = await pageRes.text();

  // ── locate captionTracks array inside ytInitialPlayerResponse ──
  const captionsIdx = html.indexOf('"captions":');
  if (captionsIdx === -1) throw new Error("no captions key in page");

  const tracksKey = '"captionTracks":';
  const tracksIdx = html.indexOf(tracksKey, captionsIdx);
  if (tracksIdx === -1) throw new Error("no captionTracks in page");

  const arrayStart = html.indexOf("[", tracksIdx + tracksKey.length);
  if (arrayStart === -1) throw new Error("captionTracks array not found");

  const arrayEnd = findJsonEnd(html, arrayStart);
  if (arrayEnd === -1) throw new Error("captionTracks array not closed");

  const tracks = JSON.parse(html.slice(arrayStart, arrayEnd + 1)) as CaptionTrack[];
  if (!tracks.length) throw new Error("captionTracks is empty");

  console.log("[transcript] captionTracks found:", tracks.map(t => `${t.languageCode}(${t.kind ?? "manual"})`).join(", "));

  // Prefer manual English → auto-generated English → any English → first available
  const pick =
    tracks.find(t => t.languageCode === "en"           && t.kind !== "asr") ??
    tracks.find(t => t.languageCode === "en"                               ) ??
    tracks.find(t => t.languageCode.startsWith("en")                       ) ??
    tracks[0];

  if (!pick.baseUrl) throw new Error("captionTrack has no baseUrl");

  const xmlRes = await fetch(pick.baseUrl);
  if (!xmlRes.ok) throw new Error(`timedtext fetch returned ${xmlRes.status}`);
  const xml = await xmlRes.text();

  const matches = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)];
  if (!matches.length) throw new Error("timedtext XML has no <text> elements");

  const content = matches
    .map(m => decodeXmlEntities(m[1].replace(/<[^>]+>/g, "")).trim())
    .filter(Boolean)
    .join(" ");

  if (!content) throw new Error("timedtext parsed content is empty");
  return { content, lang: pick.languageCode };
}

// ── Main orchestrator (tier 1 → 2 → 3) ──────────────────────────────────────

async function fetchTranscriptContent(url: string, apiKey: string): Promise<{ content: string; lang?: string }> {
  // Tier 1: Supadata
  try {
    const result = await fetchTranscriptViaSupadata(url, apiKey);
    console.log("[transcript] tier1 (supadata) ok");
    return result;
  } catch (e) {
    console.log("[transcript] tier1 failed:", (e as Error).message);
  }

  // Tier 2: yt-dlp via Flask /transcript
  try {
    const result = await fetchTranscriptViaYtDlp(url);
    console.log("[transcript] tier2 (yt-dlp) ok");
    return result;
  } catch (e) {
    console.log("[transcript] tier2 failed:", (e as Error).message);
  }

  // Tier 3: YouTube page → captionTracks → timedtext XML
  try {
    const result = await fetchTranscriptViaYouTubePage(url);
    console.log("[transcript] tier3 (youtube-page) ok");
    return result;
  } catch (e) {
    console.log("[transcript] tier3 failed:", (e as Error).message);
  }

  // Tier 4: yt-dlp audio → HuggingFace Whisper (works for any video)
  console.log("[transcript] tier4 (whisper) attempt");
  const result = await fetchTranscriptViaWhisper(url);
  console.log("[transcript] tier4 (whisper) ok");
  return result;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  console.log("[transcript] POST url:", body?.url ?? "none");

  if (!body?.url) {
    return NextResponse.json({ error: "URL manquante" }, { status: 400 });
  }

  const platform = detectPlatform(body.url);
  if (!platform) {
    return NextResponse.json(
      { error: "URL non supportée. Colle un lien YouTube, TikTok ou Instagram." },
      { status: 400 }
    );
  }

  // apiKey may be empty (quota exceeded) — fallback tiers don't need it
  const apiKey = process.env.SUPADATA_API_KEY ?? "";
  if (!apiKey) console.warn("[transcript] SUPADATA_API_KEY missing — tier1 skipped");

  try {
    const { content, lang } = await fetchTranscriptContent(body.url, apiKey);

    let title = "";
    if (platform === "youtube") {
      const videoId = extractVideoId(body.url);
      if (videoId) title = await fetchVideoTitle(videoId);
    }
    if (!title) {
      title = platform === "tiktok" ? "Vidéo TikTok"
            : platform === "instagram" ? "Vidéo Instagram"
            : "Vidéo YouTube";
    }

    // Restore punctuation via Claude
    let punctuated = content;
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const maxTokens = Math.min(Math.ceil(content.length / 2) + 200, 4096);
      const msg = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: maxTokens,
        messages: [{
          role: "user",
          content: `Add proper punctuation (periods, commas, question marks, exclamation marks) to this transcript without changing any words. Return only the punctuated text, no commentary.\n\n${content}`,
        }],
      });
      const out = msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
      if (out) {
        punctuated = out;
        console.log("[transcript] punctuation restored, chars:", punctuated.length);
      }
    } catch (e) {
      console.warn("[transcript] punctuation step failed, using raw:", (e as Error).message);
    }

    console.log("[transcript] success — title:", title, "chars:", punctuated.length, "lang:", lang);
    return NextResponse.json({ text: punctuated, title, platform, lang });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[transcript] all tiers failed:", msg);
    return NextResponse.json(
      { error: "Transcript indisponible pour cette vidéo." },
      { status: 422 }
    );
  }
}
