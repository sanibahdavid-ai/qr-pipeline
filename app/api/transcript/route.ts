import { NextRequest, NextResponse } from "next/server";
import { YoutubeTranscript } from "youtube-transcript";

function extractVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

async function fetchVideoTitle(videoId: string): Promise<string> {
  const res = await fetch(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
  );
  if (!res.ok) return videoId;
  const data = await res.json();
  return data.title ?? videoId;
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

  try {
    const [segments, title] = await Promise.all([
      YoutubeTranscript.fetchTranscript(videoId),
      fetchVideoTitle(videoId),
    ]);

    const text = segments
      .map((s) => s.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    return NextResponse.json({ text, videoId, title });
  } catch {
    return NextResponse.json(
      { error: "Transcript indisponible pour cette vidéo." },
      { status: 422 }
    );
  }
}
