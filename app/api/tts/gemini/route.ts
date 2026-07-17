import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const GEMINI_TTS_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent";

const DEFAULTS = {
  voiceName: "Schedar",
  style: "Promo/Hype",
  pace: "Rapid Fire",
  accent: "Neutral",
  temperature: 1,
  speed: 1.0,
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const text: string | undefined = body?.text;

  if (!text || !text.trim()) {
    return NextResponse.json({ error: "text manquant" }, { status: 400 });
  }

  const voiceName: string = body?.voiceName || DEFAULTS.voiceName;
  const style: string = body?.style || DEFAULTS.style;
  const pace: string = body?.pace || DEFAULTS.pace;
  const accent: string = body?.accent || DEFAULTS.accent;
  const temperature: number = typeof body?.temperature === "number" ? body.temperature : DEFAULTS.temperature;
  const speed: number = typeof body?.speed === "number" ? body.speed : DEFAULTS.speed;

  const apiKey = process.env.GOOGLE_AI_STUDIO_API_KEY_DAV;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_AI_STUDIO_API_KEY_DAV manquante" }, { status: 500 });
  }

  const payload = {
    contents: [
      {
        parts: [{ text }],
      },
    ],
    generationConfig: {
      responseModalities: ["AUDIO"],
      temperature,
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
        speakerConfig: { style, pace, accent, speed },
      },
    },
  };

  let res: Response;
  try {
    res = await fetch(GEMINI_TTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[gemini-tts] Erreur réseau:", message);
    return NextResponse.json({ error: `Erreur réseau Gemini TTS: ${message}` }, { status: 502 });
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("[gemini-tts] Erreur API:", res.status, errBody);
    let detail = errBody;
    try {
      const parsed = JSON.parse(errBody);
      detail = parsed?.error?.message ?? errBody;
    } catch {}
    return NextResponse.json(
      { error: `Erreur Gemini TTS (${res.status}): ${detail || res.statusText}` },
      { status: res.status >= 400 && res.status < 500 ? 502 : res.status }
    );
  }

  const data = await res.json().catch(() => null);
  if (!data) {
    return NextResponse.json({ error: "Réponse Gemini TTS invalide (JSON illisible)" }, { status: 502 });
  }

  const base64Audio: string | undefined =
    data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

  if (!base64Audio) {
    console.error("[gemini-tts] Pas d'audio dans la réponse:", JSON.stringify(data).slice(0, 500));
    return NextResponse.json({ error: "Pas d'audio dans la réponse Gemini TTS" }, { status: 502 });
  }

  const audioBuffer = Buffer.from(base64Audio, "base64");
  console.log("[gemini-tts] OK, voice:", voiceName, "style:", style, "pace:", pace, "accent:", accent, "size:", audioBuffer.length, "bytes");

  return new NextResponse(audioBuffer, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Disposition": 'inline; filename="speech.mp3"',
    },
  });
}
