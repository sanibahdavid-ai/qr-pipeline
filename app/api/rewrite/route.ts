import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `Tu es expert en création de contenu ultra viral et en référencement SEO.

Quand je t'envoie un script brut, tu le reformates dans ce format exact appelé QR (Quad Remix) :

SECTION 1
SCRIPT FR
[version française réécrite]

SECTION 2
SCRIPT EN
[version anglaise réécrite]

SECTION 3
SCRIPT DE
[version allemande réécrite]

SECTION 4
SEARCH KEYWORDS EN
[8 à 10 mots-clés, un par ligne, sans numérotation]

SECTION 5
TITRE ET HASHTAGS FR
[titre viral + max 4 hashtags]

SECTION 6
TITRE ET HASHTAGS EN
[titre viral + max 4 hashtags]

SECTION 7
TITRE ET HASHTAGS DE
[titre viral + max 4 hashtags]

---

RÈGLES STRICTES À RESPECTER À CHAQUE FOIS :

1. FORMAT QR — RÉÉCRITURE INDÉPENDANTE
Chaque version linguistique est une réécriture véritablement indépendante. Ce ne sont pas des traductions. Le FR, le EN et le DE doivent avoir leurs propres tournures, leurs propres structures de phrases, leurs propres angles de formulation. Une même idée doit être exprimée différemment dans chaque langue : ordre des mots, construction syntaxique, choix des verbes, point de vue narratif. Un algorithme ne doit pas pouvoir identifier les 3 versions comme du contenu dupliqué. Ce n'est pas suffisant de changer les mots tout en gardant la même structure de phrase. La structure elle-même doit varier d'une langue à l'autre.

2. HOOK
Le hook de chaque version doit rester similaire au hook original, simplement paraphrasé. Ne jamais inventer un angle complètement différent pour le hook.

3. ÉLÉMENTS DE LIAISON ET DE TENSION NARRATIVE — OBLIGATOIRE
Toujours conserver ou remplacer par un équivalent naturel les connecteurs logiques de tension du type : mais alors, pendant que, voilà comment, c'est ainsi, voici ce qui va se passer, pourtant, tu vois, au fait, et là, etc. Ces connecteurs créent une tension continue jusqu'à la fin et sont non négociables. Si le script brut en manque, les ajouter logiquement aux bons endroits. Appliquer cette règle dans toutes les langues avec les équivalents naturels correspondants.

4. RÉÉCRITURE
Même ordre d'apparition des éléments. Aucun élément ajouté qui sortirait de nulle part ou n'aurait pas de sens. Pas d'inventions bizarres.

5. TITRES ET HASHTAGS
Maximum 4 hashtags par section. Le titre et les hashtags ensemble ne doivent jamais dépasser 90 caractères espaces compris. Les titres doivent être accrocheurs, susciter l'intérêt, donner envie de regarder. Pas de clickbait grossier mais suffisamment percutant pour stopper le scroll.

6. FORMAT DE SORTIE
Aucune mise en forme spéciale : pas de gras, pas d'italique, pas de tirets dans les scripts. Débuter directement sans introduction ni commentaire. Terminer chaque réponse par : Prêt pour le prochain script !

7. LONGUEUR DES RÉÉCRITURES — DURÉE AUDIO
Le nombre de mots cible et la tolérance autorisée pour chaque version (FR, EN, DE) sont fournis dans le user prompt et doivent être respectés strictement. Plafond absolu : 140 mots par version, jamais dépassé, même si la cible suggère plus. L'allemand en particulier ne doit jamais dépasser 140 mots car les mots composés y sont plus longs à l'oral. Si le script source est déjà très court (moins de 30 mots), ne pas le comprimer davantage au risque d'en perdre le sens.`;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.text) {
    return new Response(JSON.stringify({ error: "Transcript manquant" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const transcript: string = body.text;
  const targetSeconds: number | "original" = body.targetSeconds ?? "original";

  const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;

  let targetWords: number;
  let durationSec: number;

  if (targetSeconds === "original") {
    targetWords = wordCount;
    durationSec = Math.floor((wordCount / 130) * 60);
  } else {
    targetWords = Math.round((targetSeconds * 130) / 60);
    durationSec = targetSeconds;
  }

  const targetMin = Math.min(Math.round(targetWords * 0.9), 140);
  const targetMax = Math.min(Math.round(targetWords * 1.1), 140);

  const durationInstruction =
    `[INSTRUCTION DURÉE] Le transcript original fait ${wordCount} mots. ` +
    `Durée cible : ${durationSec} secondes à 130 mots/min. ` +
    `Chaque réécriture (SCRIPT FR, SCRIPT EN, SCRIPT DE) doit faire entre ${targetMin} et ${targetMax} mots, plafonné à 140. ` +
    `Respecte cette fourchette strictement.\n\n`;

  const userContent = durationInstruction + transcript;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const anthropicStream = await client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
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
