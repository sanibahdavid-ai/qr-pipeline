import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "edge";

const LANG_NAMES: Record<string, string> = {
  FR: "français",
  EN: "anglais",
  DE: "allemand",
  ES: "espagnol",
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { script, lang, feedback, transcript } = body ?? {};

  if (!script || !lang) {
    return new Response(JSON.stringify({ error: "Paramètres manquants" }), { status: 400 });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const langName = LANG_NAMES[lang] ?? lang;

  const stream = await client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: `Voici un script en ${langName} qui ne respecte pas toutes les règles de qualité.

Script à corriger :
${script}

${transcript ? `Transcript original (source) :\n${transcript}\n\n` : ""}Problème détecté : ${feedback || "Qualité insuffisante — améliore le script"}

Règles ABSOLUES à respecter :
1. Le script doit commencer par le même mot/syllabe d'ouverture que le transcript original
2. Le nombre de phrases doit être identique à l'original
3. Aucun tiret (-, —, –) dans le script
4. Conserver les connecteurs narratifs naturels en ${langName} (mais alors, pourtant, voilà ce qui se passe, et là)
5. Aucun mot banni : incroyable, dingue, fou, amazing, insane, unbelievable, incredible, wahnsinnig, unglaublich, increíble, locura, impresionante

Retourne UNIQUEMENT le script corrigé, sans titre, sans commentaire, sans explication.`,
    }],
  });

  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          controller.enqueue(encoder.encode(chunk.delta.text));
        }
      }
      controller.close();
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
