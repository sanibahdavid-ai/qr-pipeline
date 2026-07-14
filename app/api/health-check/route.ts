import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.scripts || !body?.transcript) {
    return new Response(JSON.stringify({ error: "Missing scripts or transcript" }), { status: 400 });
  }

  const { scripts, transcript } = body as {
    scripts: Record<string, string>;
    transcript: string;
  };

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `You are a quality control expert for viral short-form video scripts. Score each script (FR, EN, DE, ES) against the original transcript.

ORIGINAL TRANSCRIPT:
${transcript}

SCRIPTS TO EVALUATE:
FR: ${scripts.FR || "(missing)"}
EN: ${scripts.EN || "(missing)"}
DE: ${scripts.DE || "(missing)"}
ES: ${scripts.ES || "(missing)"}

SCORING CRITERIA — score each script 0 to 100 points total:

1. Factual fidelity — same story, same proper names present, same narrative order as the transcript (20 pts)
   Full 20 pts if all facts, names, and order are preserved. Deduct proportionally for missing names or reordered events.

2. Rewording quality — sentence structure is meaningfully different from the source transcript; not a near-paraphrase (20 pts)
   Full 20 pts if the script clearly reformulates sentences (different word order, different constructions, recombined ideas).
   Deduct 10-15 pts if sentences closely mirror the source phrasing even with synonym swaps.
   A script that tells the same story with genuinely different phrasing should score 16-20 on this criterion.

3. Sentence count — same number of sentences as the original transcript (15 pts)
   Full 15 pts if exact match. 0 pts if count differs by more than 1.

4. No dashes — zero dashes (-, —, –) anywhere in the script (15 pts)
   0 pts if any dash is present, full 15 pts if none.

5. No banned words — ONLY these exact words are banned: incroyable, dingue, fou, amazing, insane, unbelievable, incredible, wahnsinnig, unglaublich, increíble, locura, impresionante.
   Words like "extraordinaire", "unexpected", "extraordinary", "inesperado", "sensationnel" are NOT banned — only the literal words listed above lose points. (15 pts)
   Full 15 pts if none of the banned words appear. 0 pts if any banned word appears.

6. Length fidelity — rewritten script word count within ±10% of the original transcript's word count (15 pts)
   Full 15 pts if the word count is within ±10% of the source transcript's word count. Deduct proportionally the further outside that range, 0 pts if outside ±30%.

IMPORTANT CALIBRATION: A script that faithfully tells the same story with clearly different phrasing, correct sentence count, correct length, no dashes, and no banned words should score 90-98. Reserve scores below 80 for scripts that have actual problems: wrong facts, missing names, reordered events, near-copy phrasing, dashes, banned words, or a word count outside the ±10% tolerance.

Respond ONLY with valid JSON, no markdown, no extra text:
{"scores":{"FR":0,"EN":0,"DE":0,"ES":0},"feedback":{"FR":null,"EN":null,"DE":null,"ES":null}}

For feedback: set to null if score >= 80, otherwise write a short specific correction (max 60 chars).`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    const result = JSON.parse(jsonMatch[0]);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
