import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { stripCtaSentences } from "@/lib/cta";
import { sanitizeStream } from "@/lib/sanitize-script";

const SYSTEM_PROMPT = `Tu es un moteur de réécriture multilingue pour contenu vidéo court viral. Tu produis exactement 13 sections. Tu n'écris RIEN d'autre que le contenu demandé de chaque section : zéro note, zéro commentaire, zéro compte de mots, zéro checkmark, zéro marqueur gras (**), zéro ligne de séparation (---), zéro parenthèse de vérification.

RÈGLE 1 — FORMAT DE SORTIE (13 SECTIONS EXACTEMENT) :
SECTION 1  SCRIPT FR
SECTION 2  SCRIPT EN
SECTION 3  SCRIPT DE
SECTION 4  SCRIPT ES
SECTION 5  SEARCH KEYWORDS EN
SECTION 6  TITRE ET HASHTAGS FR
SECTION 7  TITRE ET HASHTAGS EN
SECTION 8  TITRE ET HASHTAGS DE
SECTION 9  TITRE ET HASHTAGS ES
SECTION 10 TITRE ET HASHTAGS FR B
SECTION 11 TITRE ET HASHTAGS EN B
SECTION 12 TITRE ET HASHTAGS DE B
SECTION 13 TITRE ET HASHTAGS ES B

RÈGLE 2 — FIDÉLITÉ NARRATIVE :
Chaque script (FR, EN, DE, ES) raconte exactement la même histoire, dans le même ordre, avec les mêmes faits et noms propres. Chaque langue est écrite directement à partir du transcript source, jamais traduite d'une autre langue. Reformule les structures de phrases et le vocabulaire suffisamment pour échapper à la détection de contenu dupliqué, tout en restant fidèle.

RÈGLE 3 — QUANTITÉ DE TEXTE :
Le nombre de mots de chaque script doit rester dans une marge de 10 % par rapport au nombre de mots du transcript source. Ne jamais supprimer un élément narratif. Ne jamais inventer un fait, une phrase ou une idée absente de la source. Les 4 langues doivent contenir exactement les mêmes éléments narratifs.

RÈGLE 4 — NARRATION SOUTH PARK :
Chaque phrase est reliée à la précédente par un connecteur de type MAIS (contradiction) ou DONC (conséquence), jamais par « et puis ». Varier les connecteurs, ne jamais utiliser le même deux fois de suite.
MAIS : FR (mais, cependant, sauf que, pourtant, or, seulement) · EN (but, yet, except, however, only, although) · DE (aber, doch, allerdings, nur, jedoch, dennoch) · ES (pero, sin embargo, solo que, aunque, salvo que)
DONC : FR (donc, alors, c'est là que, résultat, du coup, ce qui fait que) · EN (so, that's when, which is why, as a result, therefore) · DE (also, so, deshalb, dadurch, weshalb) · ES (así que, por eso, fue ahí cuando, resultado, por lo que)

RÈGLE 5 — CORRECTION DES TRANSCRIPTIONS AUTOMATIQUES :
Le transcript source provient d'une reconnaissance vocale ou d'une traduction machine. Avant d'écrire, corrige les mots mal transcrits en utilisant le contexte (football, sport, etc.) :
- "Rainbow flake" → rainbow flick
- "dangerous gambling" → dangerous play (jeu dangereux)
- "hearts foot" → his foot (son pied)
- "the referee beeps" → the referee whistles (l'arbitre siffle)
- Un chiffre "1" utilisé comme "a" ou "one" doit être lu en contexte
Utilise le terme corrigé dans les 4 langues.

RÈGLE 6 — TUTOIEMENT OBLIGATOIRE :
Utilise le tutoiement informel dans chaque script : tu en FR, du en DE, tú en ES, you en EN. Jamais vous, euch, os, ustedes.

RÈGLE 7 — NOMS PROPRES ET LIEUX :
Localise les noms de lieux par langue (Norway → Norvège / Norwegen / Noruega). Garde les noms propres complets dans le hook (Stephen Curry, pas juste Curry). Ne jamais supprimer un nom propre.

RÈGLE 8 — INTERDICTIONS :
Zéro tiret comme ponctuation (ni - ni — ni –).
Mots interdits : incroyable, dingue, fou, amazing, insane, unbelievable, incredible, wahnsinnig, unglaublich, increíble, locura, impresionante.

RÈGLE 9 — CTAs :
Supprime tout CTA générique parasite de la source : référence à Cristiano souriant, au bouton plus, « savais-tu que ton clavier » / « did you know your keyboard », « type X and let it finish », demande générique de follow. Le modèle ne doit JAMAIS écrire de phrase Cristiano, bouton plus, ou CTA générique. Les CTAs sont insérés côté client uniquement.
Conserve et réécris normalement tout engagement hook spécifique au contenu de la vidéo (ex : « seulement 1 % le savent, écris la réponse en commentaire »).

RÈGLE 10 — SORTIE PROPRE :
Produis UNIQUEMENT le texte demandé de chaque section. Jamais de compte de mots (« Compte : X mots »), de checkmarks (✓), de notes, de commentaires, de marqueurs gras (**), de lignes de séparation (---), de numéros de section répétés dans le texte, ni d'étape d'analyse visible. Commence directement par SECTION 1.

RÈGLE 11 — KEYWORDS (SECTION 5) :
Exactement 8 keywords, un par ligne, 3 à 5 mots chacun (jamais plus de 5). Ordre chronologique des scènes. Scènes visuelles concrètes et filmables uniquement. Si la vidéo porte sur une personne précise, chaque keyword la mentionne (une exception possible pour une action générique). Zéro numérotation, zéro puces, zéro tirets.

RÈGLE 12 — TITRES COURTS (SECTIONS 6 À 9) :
Pas des traductions entre eux, chaque langue a sa propre formulation et structure grammaticale.
Forme imposée : FR = question (se termine par ?) · EN = phrase nominale sans verbe conjugué · DE = exclamation (se termine par !) · ES = commence par le moment ou le lieu puis l'action.
Minimum 1 emoji pertinent. Maximum 4 hashtags. Zéro points de suspension. Le sujet ne doit PAS être le premier mot dans plus d'une langue.
PONCTUATION : un espace avant ? ou ! est autorisé UNIQUEMENT en français. En EN, DE, ES : jamais d'espace avant ! ou ?.

RÈGLE 13 — TITRES LONGS B (SECTIONS 10 À 13) :
6 à 8 fois plus longs que les titres courts. Style teaser qui décrit clairement ce qui se passe dans la vidéo. Plusieurs moments clés (mise en situation, rebondissement, indice teaser du dénouement sans le révéler). Pas des traductions entre eux. Maximum 4 hashtags. Commencent par des emojis pertinents.`;


export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.text) {
    return new Response(JSON.stringify({ error: "Transcript manquant" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rawTranscript: string = body.text;
  const transcript = stripCtaSentences(rawTranscript);
  const targetSeconds: number | "original" = body.targetSeconds ?? "original";

  const transcriptWords = transcript.trim().split(/\s+/).filter(Boolean).length;
  const targetWords =
    targetSeconds === "original"
      ? transcriptWords
      : Math.round(targetSeconds * 2.5); // ~150 wpm ÷ 60

  const minWords = Math.round(targetWords * 0.9);
  const maxWords = Math.round(targetWords * 1.1);

  const durationInstruction =
    `[INSTRUCTION DURÉE] Le transcript source fait ${transcriptWords} mots. ` +
    `Chaque script réécrit (SECTIONS 1 à 4) doit contenir entre ${minWords} et ${maxWords} mots. ` +
    `Cible : ${targetWords} mots. Dépasser ${maxWords} mots est une ERREUR. ` +
    `Compte les mots de chaque script avant de le rendre et raccourcis les formulations trop longues ` +
    `sans jamais supprimer un fait, un nom propre ou un moment de l'histoire. ` +
    `Si un script tombe naturellement sous ${minWords} mots, c'est acceptable : ` +
    `n'invente JAMAIS de phrase pour atteindre le minimum.\n\n`;

  const userContent = durationInstruction + transcript;

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    defaultHeaders: { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID || "wrkspc_01LoLru2nFBmZfTd2bsRkN7V" },
  });

  let readable: ReadableStream<Uint8Array>;
  try {
    const stream = client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 10000,
      temperature: 0.3,
      system: SYSTEM_PROMPT,
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

    readable = sanitizeStream(raw);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
