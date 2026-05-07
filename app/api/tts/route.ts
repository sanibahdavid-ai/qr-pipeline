import { NextRequest } from "next/server";

export const runtime = "nodejs";

const API_KEY = process.env.MINIMAX_API_KEY;

const PROVIDERS = {
  "ai33-elevenlabs": {
    url: "https://api.ai33.pro/v1/text-to-speech/aTTiK3YzK3dXETpuDE2h",
    body: (text: string) => ({
      text,
      model_id: "eleven_multilingual_v2",
    }),
  },
  "ai33-minimax": {
    url: "https://api.ai33.pro/v1m/task/text-to-speech",
    body: (text: string) => ({
      text,
      model: "speech-2.6-hd",
      voice_setting: {
        voice_id: "273587280617675",
      },
    }),
  },
} as const;

type Provider = keyof typeof PROVIDERS;

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

  const { text, language, provider, title } = body ?? {};

  if (!text || !language || !provider || !title) {
    return Response.json(
      { error: "Parametres manquants : text, language, provider, title" },
      { status: 400 }
    );
  }

  if (!(provider in PROVIDERS)) {
    return Response.json(
      { error: `Provider inconnu : ${provider}` },
      { status: 400 }
    );
  }

  const cfg = PROVIDERS[provider as Provider];

  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      "xi-api-key": API_KEY ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cfg.body(text)),
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

  // apiKey renvoyé pour que le client puisse poller AI33pro directement (évite timeout Vercel)
  return Response.json({ taskId, filename, apiKey: API_KEY });
}
