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
1. Hook opening — same opening word/syllable pattern as the original transcript (20 pts)
2. Sentence count — same number of sentences as the original (20 pts)
3. No dashes — zero dashes (-, —, –) used in the script (15 pts)
4. Connectors — narrative connectors from original are preserved (15 pts)
5. Independence — script uses different content/angles, not a direct translation of another version (15 pts)
6. No banned words — ONLY these exact words are banned: incroyable, dingue, fou, amazing, insane, unbelievable, incredible, wahnsinnig, unglaublich, increíble, locura, impresionante. Words like "extraordinaire", "unexpected", "extraordinary", "inesperado" are NOT banned — only the literal words above lose points. (15 pts)

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
