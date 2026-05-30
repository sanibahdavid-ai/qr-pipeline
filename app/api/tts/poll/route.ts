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

  // Minimax tasks live under /v1m/; ElevenLabs tasks under /v1/
  const pollUrl =
    provider === "ai33-minimax"
      ? `https://api.ai33.pro/v1m/task/${taskId}`
      : `https://api.ai33.pro/v1/task/${taskId}`;

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
  console.log("POLL RESPONSE:", JSON.stringify(data));

  // Normalise the response so the client always sees { status, audio_url }
  const status: string =
    data.status ?? data.data?.status ?? "";
  const audio_url: string =
    data.audio_url ??
    data.audioUrl ??
    data.audio ??
    data.audio_address ??
    data.data?.audio_url ??
    data.data?.audio ??
    data.data?.audio_address ??
    "";

  return Response.json({ status, audio_url, _raw: data });
}
