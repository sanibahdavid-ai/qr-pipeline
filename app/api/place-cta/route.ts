import { NextRequest } from "next/server";
// MIGRATED TO GEMINI — was: import Anthropic from "@anthropic-ai/sdk";
import { geminiCreateJson } from "@/lib/gemini-client";

export const runtime = "edge";

type CtaType = "ronaldo" | "tiktok";

function splitSentences(text: string): string[] {
  const parts: string[] = [];
  let pos = 0;
  const re = /[.!?…]+\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const chunk = text.slice(pos, m.index + m[0].length).trim();
    if (chunk) parts.push(chunk);
    pos = m.index + m[0].length;
  }
  if (pos < text.length) {
    const tail = text.slice(pos).trim();
    if (tail) parts.push(tail);
  }
  return parts;
}

function fallbackIndex(ctaType: CtaType, sentenceCount: number): number {
  const ratio = ctaType === "ronaldo" ? 0.3 : 0.8;
  const idx = Math.round(sentenceCount * ratio) - 1;
  return Math.max(1, Math.min(idx, sentenceCount - 2));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { script, ctaType, ctaText } = (body ?? {}) as {
    script?: string;
    ctaType?: CtaType;
    ctaText?: string;
  };

  if (!script || !ctaType || !ctaText) {
    return new Response(JSON.stringify({ error: "Missing script, ctaType or ctaText" }), { status: 400 });
  }

  const sentences = splitSentences(script);
  if (sentences.length < 3) {
    return new Response(JSON.stringify({ insertAfterSentenceIndex: Math.max(0, sentences.length - 1) }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const bound = (idx: number) => Math.max(1, Math.min(idx, sentences.length - 2));

  // MIGRATED TO GEMINI — was: new Anthropic + client.messages.create

  const prompt = `Tu reçois un script vidéo court et un CTA. Ton rôle est de placer le CTA à l'emplacement narrativement le plus stratégique.

SCRIPT (phrases numérotées, 0-indexed) :
${sentences.map((s, i) => `[${i}] ${s}`).join("\n")}

TYPE DE CTA : ${ctaType.toUpperCase()}
TEXTE DU CTA : ${ctaText}

RÈGLES ABSOLUES DE POSITION :
- JAMAIS après la 1ère phrase
- JAMAIS comme dernière phrase
- Pour un CTA type "RONALDO" : l'index retourné doit être entre 25% et 45% du nombre total de phrases, JAMAIS avant. Pour un script de 24 phrases, ça veut dire entre la phrase 6 et la phrase 11 minimum — PAS la phrase 5 ou avant.
- Calcule d'abord: minIndex = Math.ceil(totalSentences * 0.25), maxIndex = Math.floor(totalSentences * 0.45)
- Ton index retourné DOIT être compris entre minIndex et maxIndex inclus
- Pour un CTA type "TIKTOK" : entre 75% et 90% du script
- Ne retourne JAMAIS un index en dehors de ces bornes, peu importe où tu penses qu'un "bon moment narratif" se trouve

Retourne UNIQUEMENT un JSON: {"insertAfterSentenceIndex": <int>} où l'index est celui de la phrase APRÈS laquelle insérer le CTA (0-indexed).`;

  try {
    const result = await geminiCreateJson("", prompt, 128) as { insertAfterSentenceIndex?: number };
    const raw = Number(result.insertAfterSentenceIndex);
    const insertAfterSentenceIndex = Number.isFinite(raw) ? bound(raw) : fallbackIndex(ctaType, sentences.length);

    return new Response(JSON.stringify({ insertAfterSentenceIndex }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ insertAfterSentenceIndex: fallbackIndex(ctaType, sentences.length) }), {
      headers: { "Content-Type": "application/json" },
    });
  }
}
