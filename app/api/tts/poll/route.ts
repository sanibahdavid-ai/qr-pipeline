import { NextRequest } from "next/server";

export const runtime = "nodejs";

const API_KEY = process.env.MINIMAX_API_KEY;

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");
  const provider = req.nextUrl.searchParams.get("provider") ?? "";
  const apiKey = API_KEY ?? "";

  if (!taskId) {
    return Response.json({ error: "taskId manquant" }, { status: 400 });
  }

  // Both ai33-elevenlabs and ai33-minimax use the unified /v1/task/ endpoint.
  // (The /v1m/ path only exists for the submit step, not polling.)
  const pollUrl = `https://api.ai33.pro/v1/task/${taskId}`;
  console.log(`[TTS poll] provider=${provider} url=${pollUrl}`);

  const res = await fetch(pollUrl, {
    headers: { "xi-api-key": apiKey },
  });

  if (!res.ok) {
    return Response.json(
      { error: `Erreur polling : ${res.status}` },
      { status: 502 }
    );
  }

  const data = await res.json();
  console.log("[TTS poll] raw response:", JSON.stringify(data));

  // AI33 wraps the audio URL inside metadata.audio_url for all providers.
  // Also check top-level fallbacks for any future shape changes.
  const status: string =
    data.status ?? data.data?.status ?? "";

  const audio_url: string =
    data.metadata?.audio_url ??   // ← primary: AI33 always puts it here
    data.audio_url ??
    data.audioUrl ??
    data.audio ??
    data.audio_address ??
    data.output_url ??
    data.output?.audio_url ??
    data.output?.audio ??
    data.result?.audio_url ??
    data.result?.audio ??
    data.data?.audio_url ??
    data.data?.audio ??
    data.data?.audio_address ??
    "";

  console.log(`[TTS poll] status="${status}" audio_url="${audio_url}"`);

  return Response.json({ status, audio_url, _raw: data });
}
