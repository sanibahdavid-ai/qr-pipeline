import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { sanitizeStream } from "@/lib/sanitize-script";

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

  const langName = LANG_NAMES[lang] ?? lang;

  const userContent = `Voici un script en ${langName} qui ne respecte pas toutes les règles de qualité.

Script à corriger :
${script}

${transcript ? `Transcript original (source) :\n${transcript}\n\n` : ""}Problème détecté : ${feedback || "Qualité insuffisante — améliore le script"}

Règles ABSOLUES à respecter :
1. Le script doit commencer par le même mot/syllabe d'ouverture que le transcript original
2. Le nombre de phrases doit être identique à l'original
3. Aucun tiret (-, —, –) dans le script
4. Conserver les connecteurs narratifs naturels en ${langName} (mais alors, pourtant, voilà ce qui se passe, et là)
5. Aucun mot banni : incroyable, dingue, fou, amazing, insane, unbelievable, incredible, wahnsinnig, unglaublich, increíble, locura, impresionante

Retourne UNIQUEMENT le script corrigé, sans titre, sans commentaire, sans explication.`;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const stream = client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    temperature: 0.3,
    messages: [{ role: "user", content: userContent }],
  });

  const encoder = new TextEncoder();
  const raw = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(sanitizeStream(raw), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
