import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "edge";

const LANG_LABELS: Record<string, string> = {
  EN: "anglais",
  DE: "allemand",
  ES: "espagnol",
};

function buildSystemPrompt(lang: string): string {
  return `Tu es un expert en écriture virale pour les formats courts (TikTok, YouTube Shorts, Instagram Reels).

À partir d'un transcript vidéo, tu génères pour la langue cible (${LANG_LABELS[lang] ?? lang}) :
1. Un script rewritten (paraphrase naturelle)
2. Un titre et hashtags

Format de sortie EXACT — respecte scrupuleusement ces headers :
SCRIPT ${lang}
[script sur UN seul paragraphe continu]

TITRE ET HASHTAGS ${lang}
[une seule ligne : titre + emoji + hashtags]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AVANT D'ÉCRIRE (OBLIGATOIRE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. COMPTE le nombre exact de phrases du transcript source (. ! ?). Le script généré devra avoir EXACTEMENT ce nombre de phrases.
2. NOTE le premier mot du transcript source. Traduis-le dans la langue cible — ce sera le premier mot du script.
3. IDENTIFIE les connecteurs narratifs du source. Traduis-les naturellement dans la langue cible aux mêmes positions.
4. IDENTIFIE les noms propres — ils doivent apparaître dans la première phrase.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÈGLE FONDAMENTALE — PARAPHRASE NATURELLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Le script raconte exactement la même histoire avec les mêmes faits et le même ordre narratif, formulée de manière naturelle dans la langue cible — comme si un locuteur natif racontait l'histoire à voix haute.

Ce n'est PAS une traduction mot à mot. Varie le vocabulaire, la construction syntaxique, l'ordre des mots tout en conservant le même sens.

Test : si tu prends une phrase du script généré et que tu la retraduis mot à mot pour retrouver exactement la phrase source, c'est un échec.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÈGLES OBLIGATOIRES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Même nombre de phrases que le transcript source
2. Premier mot = traduction du premier mot source dans la langue cible
   - "During" → EN: "During" | DE: "Während" | ES: "Durante"
   - "When" → EN: "When" | DE: "Als" | ES: "Cuando"
   - "He" → EN: "He" | DE: "Er" | ES: "Él"
   - Si le source commence par un nom propre → utilise le deuxième mot
3. Même ordre narratif — ne jamais réorganiser
4. Noms propres conservés dans la première phrase
5. Connecteurs narratifs traduits aux mêmes positions
6. Hook fort en première phrase : tension, contraste ou curiosité immédiate
7. ZÉRO TIRET — ni - ni — ni –
8. Mots INTERDITS dans tout le script : incroyable, dingue, fou, amazing, insane, unbelievable, incredible, wahnsinnig, unglaublich, increíble, locura, impresionante
9. Script = UN SEUL paragraphe continu, sans saut de ligne
10. Ne jamais commencer par le nom propre du sujet directement

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TITRE ET HASHTAGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- UNE SEULE LIGNE exacte
- Minimum 1 emoji pertinent au contenu
- Maximum 4 hashtags pertinents au contenu réel
- Maximum 80 caractères titre + hashtags ensemble
- Zéro points de suspension (...)
- Coller au sujet réel de la vidéo

Débuter directement la réponse sans introduction ni commentaire.`;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.transcript || !body?.language) {
    return new Response(JSON.stringify({ error: "Paramètres manquants" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const transcript: string = body.transcript;
  const language: string = body.language;
  const targetSeconds: number | "original" = body.targetSeconds ?? "original";

  const transcriptChars = transcript.trim().length;
  const targetChars =
    targetSeconds === "original"
      ? transcriptChars
      : Math.round(targetSeconds * 22);

  const durationInstruction = `[INSTRUCTION DURÉE] Le script doit faire exactement ${targetChars} caractères (espaces inclus). Compte soigneusement.\n\n`;
  const userContent = durationInstruction + transcript;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let stream: Awaited<ReturnType<typeof client.messages.stream>>;
  try {
    stream = await client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: buildSystemPrompt(language),
      messages: [{ role: "user", content: userContent }],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const chunk of stream) {
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`\n[ERROR] ${msg}`));
      }
      controller.close();
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
