import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

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

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Tu reçois un script vidéo court et un CTA. Ton rôle est de placer le CTA à l'emplacement narrativement le plus stratégique.

SCRIPT (phrases numérotées, 0-indexed) :
${sentences.map((s, i) => `[${i}] ${s}`).join("\n")}

TYPE DE CTA : ${ctaType.toUpperCase()}
TEXTE DU CTA : ${ctaText}

RÈGLES ABSOLUES :
- JAMAIS après la 1ère phrase
- JAMAIS comme dernière phrase
- Pour un CTA type "RONALDO" : place-le dans la PREMIÈRE MOITIÉ du script (entre la 2ème phrase et la phrase à ~45% du script), juste avant une escalade ou une petite révélation qui va donner envie de continuer
- Pour un CTA type "TIKTOK" : place-le dans les 75-90% du script (jamais la dernière phrase), après un moment fort et avant une résolution ou un dernier rebondissement

Retourne UNIQUEMENT un JSON: {"insertAfterSentenceIndex": <int>} où l'index est celui de la phrase APRÈS laquelle insérer le CTA (0-indexed).`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 128,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    const result = JSON.parse(jsonMatch[0]) as { insertAfterSentenceIndex?: number };
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
