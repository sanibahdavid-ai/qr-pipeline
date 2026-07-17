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

const PCM_SAMPLE_RATE_DEFAULT = 24000;
const PCM_CHANNELS = 1;
const PCM_BITS_PER_SAMPLE = 16;

// Gemini TTS returns raw LINEAR16 PCM (no container), so we prepend a
// standard 44-byte WAV header ourselves — browsers can't play bare PCM.
function pcmToWav(pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

// Gemini's inlineData.mimeType looks like "audio/L16;codec=pcm;rate=24000" — pull the real rate if present.
function extractSampleRate(mimeType: string | undefined): number {
  const match = mimeType?.match(/rate=(\d+)/);
  return match ? parseInt(match[1], 10) : PCM_SAMPLE_RATE_DEFAULT;
}

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

  // Gemini's TTS API has no dedicated style/pace/accent/speed fields — delivery is
  // steered by prefixing the text with a natural-language instruction (the documented
  // technique for this model). A literal "speakerConfig" field is rejected by the API.
  const styledText = `Style de narration : ${style}. Débit : ${pace}. Accent : ${accent}. Vitesse relative : ${speed}x par rapport à la normale.\n\n${text}`;

  const payload = {
    contents: [
      {
        parts: [{ text: styledText }],
      },
    ],
    generationConfig: {
      responseModalities: ["AUDIO"],
      temperature,
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
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

  const part = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  const base64Audio: string | undefined = part?.data;

  if (!base64Audio) {
    console.error("[gemini-tts] Pas d'audio dans la réponse. Réponse complète:", JSON.stringify(data).slice(0, 2000));
    return NextResponse.json({ error: "Pas d'audio dans la réponse Gemini TTS" }, { status: 502 });
  }

  const pcmBuffer = Buffer.from(base64Audio, "base64");
  const sampleRate = extractSampleRate(part?.mimeType);
  const wavBuffer = pcmToWav(pcmBuffer, sampleRate, PCM_CHANNELS, PCM_BITS_PER_SAMPLE);
  console.log(
    "[gemini-tts] OK, voice:", voiceName, "style:", style, "pace:", pace, "accent:", accent,
    "mimeType:", part?.mimeType, "sampleRate:", sampleRate, "pcmSize:", pcmBuffer.length, "wavSize:", wavBuffer.length, "bytes"
  );

  const responseBody = wavBuffer.buffer.slice(
    wavBuffer.byteOffset,
    wavBuffer.byteOffset + wavBuffer.byteLength
  ) as ArrayBuffer;

  return new NextResponse(responseBody, {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Disposition": 'inline; filename="speech.wav"',
    },
  });
}
