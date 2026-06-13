import { NextRequest } from "next/server";

export const runtime = "nodejs";

const API_KEY = process.env.MINIMAX_API_KEY;
const BASE = "https://api.ai33.pro";

function sanitizeFilename(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { text, language, provider, title, speed, voice, model_id } = body ?? {};

  if (!text || !language || !provider || !title) {
    return Response.json(
      { error: "Parametres manquants : text, language, provider, title" },
      { status: 400 }
    );
  }

  const apiKey = API_KEY ?? "";
  const voiceId: string = voice ?? "";

  let url: string;
  let requestBody: Record<string, unknown>;

  if (voiceId.startsWith("elevenlabs_")) {
    // ElevenLabs voices via AI33 v1 proxy
    url = `${BASE}/v1/text-to-speech/${voiceId}`;
    requestBody = {
      text,
      model_id: model_id ?? "eleven_multilingual_v3",
    };
  } else if (voiceId.startsWith("kokoro_")) {
    // Kokoro voices via AI33 v1 proxy (no model_id, no language, no similarity)
    url = `${BASE}/v1/text-to-speech/${voiceId}`;
    requestBody = { text };
  } else if (voiceId.startsWith("clone_")) {
    // Clone voices use Minimax /v1m/ infrastructure; voice_id is the numeric part only
    const numericId = voiceId.slice("clone_".length);
    url = `${BASE}/v1m/task/text-to-speech`;
    requestBody = {
      text,
      model: "speech-2.6-hd",
      voice_setting: { voice_id: numericId },
    };
  } else {
    // Legacy Minimax digit IDs
    url = `${BASE}/v1m/task/text-to-speech`;
    requestBody = {
      text,
      model: "speech-2.6-hd",
      voice_setting: { voice_id: voiceId || "273587280617675" },
    };
  }

  console.log(`[TTS submit] voice=${voiceId} url=${url} speed=${speed}`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const err = await res.text();
    return Response.json({ error: `Erreur API TTS : ${err}` }, { status: 502 });
  }

  const data = await res.json();
  console.log("[TTS submit] raw response:", JSON.stringify(data));

  const taskId = data.task_id ?? data.id ?? data.taskId;
  if (!taskId) {
    return Response.json(
      { error: "Pas de task_id dans la reponse", raw: data },
      { status: 502 }
    );
  }
  console.log("[TTS submit] taskId:", taskId);

  const filename = `${sanitizeFilename(title)}_${language.toUpperCase()}.mp3`;
  return Response.json({ taskId, filename, apiKey });
}
