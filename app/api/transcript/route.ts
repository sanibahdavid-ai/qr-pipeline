import { NextRequest, NextResponse } from "next/server";

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
};

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

  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) {
    console.error("[transcript] SUPADATA_API_KEY missing");
    return NextResponse.json(
      { error: "Configuration serveur manquante" },
      { status: 500 }
    );
  }

  try {
    const params = new URLSearchParams({
      url: `https://www.youtube.com/watch?v=${videoId}`,
      text: "true",
      mode: "auto",
    });

    const res = await fetch(`https://api.supadata.ai/v1/transcript?${params}`, {
      headers: { "x-api-key": apiKey },
    });

    console.log("[transcript] Supadata status:", res.status);

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error("[transcript] Supadata error:", res.status, errBody.slice(0, 200));
      return NextResponse.json(
        { error: "Transcript indisponible pour cette vidéo." },
        { status: 422 }
      );
    }

    const data = (await res.json()) as SupadataResponse;

    // Cas asynchrone (vidéos longues / fallback IA)
    if (data.jobId) {
      console.log("[transcript] async job started:", data.jobId);
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const jobRes = await fetch(
          `https://api.supadata.ai/v1/transcript/${data.jobId}`,
          { headers: { "x-api-key": apiKey } }
        );
        if (!jobRes.ok) continue;
        const jobData = (await jobRes.json()) as {
          status: string;
          result?: { content?: string };
        };
        if (jobData.status === "completed" && jobData.result?.content) {
          const text = jobData.result.content.trim();
          const title = await fetchVideoTitle(videoId);
          console.log("[transcript] async OK, chars:", text.length);
          return NextResponse.json({ text, videoId, title });
        }
        if (jobData.status === "failed") {
          console.error("[transcript] async job failed");
          break;
        }
      }
      return NextResponse.json(
        { error: "Traitement trop long. Réessaie dans quelques minutes." },
        { status: 504 }
      );
    }

    const text = data.content?.trim();
    if (!text) {
      console.error("[transcript] empty content from Supadata");
      return NextResponse.json(
        { error: "Transcript vide pour cette vidéo." },
        { status: 422 }
      );
    }

    const title = await fetchVideoTitle(videoId);
    console.log("[transcript] success, title:", title, "chars:", text.length);
    return NextResponse.json({ text, videoId, title });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[transcript] Supadata fetch failed:", msg);
    return NextResponse.json(
      { error: "Erreur lors de la récupération du transcript." },
      { status: 500 }
    );
  }
}
