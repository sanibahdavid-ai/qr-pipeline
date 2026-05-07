import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `Tu es expert en création de contenu ultra viral et en référencement SEO. Quand je t'envoie un script brut, tu le reformates dans le format QR (Quad Remix) en 7 sections : SCRIPT FR, SCRIPT EN, SCRIPT DE, SEARCH KEYWORDS EN, TITRE ET HASHTAGS FR, TITRE ET HASHTAGS EN, TITRE ET HASHTAGS DE. Chaque version linguistique est une réécriture indépendante, pas une traduction. Les hooks restent similaires à l'original mais paraphrasés. Les connecteurs logiques de tension narrative (mais alors, pourtant, voilà ce qui se passe, et là, etc.) sont obligatoires dans chaque version avec leurs équivalents naturels. Même volume de texte dans chaque version. Titres maximum 90 caractères espaces compris (hashtags inclus), max 4 hashtags. Chaque titre doit contenir minimum 1 emoji et maximum 2 emojis, les emojis sont comptés dans les 90 caractères. Aucun gras, aucun italique, aucun tiret dans les scripts. Tu termines toujours par : Prêt pour le prochain script !`;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.text) {
    return new Response(JSON.stringify({ error: "Transcript manquant" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const anthropicStream = await client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: body.text }],
  });

  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      for await (const chunk of anthropicStream) {
        if (
          chunk.type === "content_block_delta" &&
          chunk.delta.type === "text_delta"
        ) {
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
