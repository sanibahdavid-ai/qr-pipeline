import { NextRequest } from "next/server";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const VOICE_ID = "aTTiK3YzK3dXETpuDE2h";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { text } = body ?? {};

  if (!text) {
    return Response.json({ error: "text manquant" }, { status: 400 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  console.log("[EL] ELEVENLABS_API_KEY présente :", !!apiKey);

  if (!apiKey) {
    return Response.json({ error: "ELEVENLABS_API_KEY manquante" }, { status: 500 });
  }

  try {
    const client = new ElevenLabsClient({ apiKey });

    console.log("[EL] Appel textToSpeech.convert...");
    const audioStream = await client.textToSpeech.convert(VOICE_ID, {
      text,
      modelId: "eleven_multilingual_v2",
      outputFormat: "mp3_44100_128",
    });
    console.log("[EL] Stream reçu, type :", typeof audioStream);

    return new Response(audioStream as unknown as ReadableStream, {
      headers: { "Content-Type": "audio/mpeg" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[EL] Erreur :", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
