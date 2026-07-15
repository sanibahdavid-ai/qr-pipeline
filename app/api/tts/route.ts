import { NextRequest } from "next/server";

export const runtime = "nodejs";

const API_KEY = process.env.MINIMAX_API_KEY;
const BASE = "https://api.ai33.pro";

const VOICE_PREFIXES = ["elevenlabs_", "minimax_", "clone_", "edge_", "kokoro_", "vbee_", "fishaudio_"];

// AI33 v3 requires every voice_id to carry a provider prefix. Legacy bare
// Minimax digit IDs (pre-v3) need to be upgraded to the minimax_ prefix.
function normalizeVoiceId(voiceId: string): string {
  if (VOICE_PREFIXES.some((p) => voiceId.startsWith(p))) return voiceId;
  return `minimax_${voiceId || "273587280617675"}`;
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
  const voiceId = normalizeVoiceId(voice ?? "");

  const requestBody: Record<string, unknown> = { text, voice_id: voiceId };
  if (voiceId.startsWith("elevenlabs_")) {
    requestBody.model_id = model_id ?? "eleven_v3";
  }
  if (typeof speed === "number" && !Number.isNaN(speed)) {
    requestBody.speed = Math.min(1.5, Math.max(0.5, speed));
  }

  console.log(`[TTS submit] voice_id=${voiceId} speed=${requestBody.speed ?? "default"}`);

  const res = await fetch(`${BASE}/v3/text-to-speech`, {
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

  return Response.json({ taskId });
}
