import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { script } = body ?? {};

  if (!script || typeof script !== "string") {
    return Response.json({ error: "script manquant" }, { status: 400 });
  }

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 64,
      temperature: 0.3,
      system: "Tu es un assistant qui génère des titres courts. Réponds uniquement avec le titre, sans guillemets ni ponctuation finale.",
      messages: [
        {
          role: "user",
          content: `Résume ce script en un titre court de 5 à 8 mots maximum, sans ponctuation finale, qui permette d'identifier immédiatement le sujet. Exemple : "Neymar carton rouge polémique arbitrage" ou "Ronaldo maison la plus chère". Script :\n\n${script.slice(0, 1500)}`,
        },
      ],
    });

    const text =
      response.content[0]?.type === "text" ? response.content[0].text.trim() : "";

    return Response.json({ title: text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[generate-title] Erreur:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
