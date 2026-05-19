import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const GOOGLE_TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { text, voice, languageCode, speakingRate } = body ?? {};

  if (!text || !voice || !languageCode) {
    return NextResponse.json(
      { error: "text, voice, languageCode requis" },
      { status: 400 }
    );
  }

  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_TTS_API_KEY manquante" }, { status: 500 });
  }

  const payload = {
    input: { text },
    voice: { languageCode, name: voice },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: Math.max(0.25, Math.min(4.0, speakingRate ?? 1.0)),
    },
  };

  const res = await fetch(`${GOOGLE_TTS_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[google-tts] Erreur:", err);
    return NextResponse.json({ error: `Erreur Google TTS: ${err}` }, { status: 502 });
  }

  const data = await res.json();

  if (!data.audioContent) {
    return NextResponse.json({ error: "Pas d'audio dans la réponse" }, { status: 502 });
  }

  const audioBuffer = Buffer.from(data.audioContent, "base64");
  console.log("[google-tts] OK, voice:", voice, "size:", audioBuffer.length, "bytes");

  return new NextResponse(audioBuffer, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Disposition": 'inline; filename="speech.mp3"',
    },
  });
}
