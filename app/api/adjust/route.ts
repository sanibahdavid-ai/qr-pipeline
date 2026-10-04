import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { sanitizeStream } from "@/lib/sanitize-script";

const DURATION_WORDS: Record<string, number> = {
  "10s":    22,
  "15s":    32,
  "30s":    65,
  "45s":    98,
  "1min":  130,
  "1min30": 195,
  "2min":  260,
};

const LANG_NAMES: Record<string, string> = {
  FR: "français",
  EN: "anglais",
  DE: "allemand",
  ES: "espagnol",
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { text, language, targetDuration, customSeconds } = body ?? {};

  if (!text || !language || (!targetDuration && !customSeconds)) {
    return new Response(JSON.stringify({ error: "Paramètres manquants" }), { status: 400 });
  }

  let targetWords: number;
  let durationLabel: string;
  if (customSeconds && customSeconds > 0) {
    targetWords = Math.round((customSeconds * 130) / 60);
    durationLabel = `${customSeconds}s`;
  } else {
    targetWords = DURATION_WORDS[targetDuration];
    durationLabel = targetDuration;
    if (!targetWords) {
      return new Response(JSON.stringify({ error: `Durée invalide : ${targetDuration}` }), { status: 400 });
    }
  }

  const langName = LANG_NAMES[language] ?? language;

  const userContent = `Voici un script en ${langName} au format QR (Quad Remix). Réécris-le pour qu'il dure exactement ${durationLabel} à voix haute à 130 mots par minute (environ ${targetWords} mots).

Règles absolues :
- Conserve les connecteurs de tension narrative naturels en ${langName} (mais alors, pourtant, voilà ce qui se passe, et là, et leurs équivalents)
- Aucun gras, aucun italique, aucun tiret dans le script
- Même style, ton et structure narrative que l'original
- Adapte uniquement la longueur sans changer le sens ni le registre
- N'ajoute JAMAIS de phrase mentionnant Cristiano, un bouton plus, "did you know your keyboard"/"savais-tu que ton clavier", ou tout autre appel à l'action générique de ce type : ces CTAs sont insérés séparément côté client, jamais par toi, même si l'original en contenait un
- Retourne uniquement le script réécrit, sans titre, sans commentaire, sans explication

Script original :
${text}`;

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    defaultHeaders: { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID || "wrkspc_01LoLru2nFBmZfTd2bsRkN7V" },
  });

  const stream = client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
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
