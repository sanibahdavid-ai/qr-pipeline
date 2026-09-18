import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Each model has its own daily free-tier quota. When one is exhausted we move to
// the next instead of failing the request.
// Order is measured, not arbitrary: the lite models complete all 13 sections in
// ~10s and spend no thinking tokens, and 3.1 tracks the source word count most
// closely. gemini-flash-latest is last because it is frequently 503 and its
// thinking tokens eat the output budget, truncating the run mid-script.
const MODEL_CHAIN = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-flash-latest",
];

const DEFAULT_MODEL = MODEL_CHAIN[0];

function errorStatus(error: unknown): number | undefined {
  return (error as { status?: number })?.status;
}

// A daily-quota 429 will never succeed on retry — only a per-minute one will.
function isDailyQuotaExhausted(error: unknown): boolean {
  if (errorStatus(error) !== 429) return false;
  const msg = String((error as { message?: string })?.message ?? "");
  return /PerDay|exceeded your current quota|RESOURCE_EXHAUSTED/i.test(msg);
}

function isTransient(error: unknown): boolean {
  const status = errorStatus(error);
  if (status === 503) return true;
  return status === 429 && !isDailyQuotaExhausted(error);
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || i === attempts - 1) throw error;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw lastError;
}

// Runs `fn` against each model in turn. Moves to the next model when this one is
// out of daily quota, or still overloaded after its retries — a different model
// usually has capacity. Any other error propagates immediately.
async function withModelFallback<T>(
  fn: (model: string) => Promise<T>,
  preferred?: string
): Promise<T> {
  const chain = preferred && !MODEL_CHAIN.includes(preferred)
    ? [preferred, ...MODEL_CHAIN]
    : MODEL_CHAIN;

  let lastError: unknown;
  for (const model of chain) {
    try {
      return await withRetry(() => fn(model));
    } catch (error) {
      lastError = error;
      const exhausted = isDailyQuotaExhausted(error);
      const overloaded = errorStatus(error) === 503;
      if (!exhausted && !overloaded) throw error;
      console.warn(`[gemini] ${model} unavailable (${exhausted ? "quota" : "overloaded"}), falling back`);
    }
  }
  throw lastError;
}

function buildParts(userContent: string, imageBase64?: string) {
  const parts: any[] = [];
  if (imageBase64) {
    const mimeType = imageBase64.startsWith("iVBORw") ? "image/png" : "image/jpeg";
    parts.push({ inlineData: { data: imageBase64, mimeType } });
  }
  parts.push({ text: userContent });
  return parts;
}

export async function geminiStream(
  systemPrompt: string,
  userContent: string,
  maxTokens: number = 10000,
  model?: string,
  imageBase64?: string
) {
  const config: any = { systemInstruction: systemPrompt, maxOutputTokens: maxTokens };
  const parts = buildParts(userContent, imageBase64);

  const { stream, usedModel } = await withModelFallback(async (m) => {
    const s = await ai.models.generateContentStream({
      model: m,
      contents: [{ role: "user", parts }],
      config,
    });
    return { stream: s, usedModel: m };
  }, model);

  return new ReadableStream({
    async start(controller) {
      let finishReason: string | undefined;
      let charCount = 0;
      try {
        for await (const chunk of stream) {
          const reason = chunk.candidates?.[0]?.finishReason;
          if (reason) finishReason = reason;
          const text = chunk.text;
          if (text) {
            charCount += text.length;
            controller.enqueue(new TextEncoder().encode(text));
          }
        }
        // A stream that ends on anything but STOP was cut short; surfacing it as
        // an error lets the client retry instead of showing a truncated script.
        if (finishReason && finishReason !== "STOP") {
          console.error(`[gemini] ${usedModel} stopped early: ${finishReason} after ${charCount} chars`);
          controller.error(new Error(`Génération interrompue (${finishReason}). Réessaie.`));
          return;
        }
        controller.close();
      } catch (error) {
        console.error(`[gemini] stream error on ${usedModel}:`, error);
        controller.error(error);
      }
    },
  });
}

export async function geminiCreate(
  systemPrompt: string,
  userContent: string,
  maxTokens: number = 10000,
  model?: string,
  imageBase64?: string
) {
  const config: any = { systemInstruction: systemPrompt, maxOutputTokens: maxTokens };
  const parts = buildParts(userContent, imageBase64);

  const response = await withModelFallback(
    (m) => ai.models.generateContent({ model: m, contents: [{ role: "user", parts }], config }),
    model
  );

  return { text: response.text || "" };
}

export async function geminiCreateJson(
  systemPrompt: string,
  userContent: string,
  maxTokens: number = 10000,
  model?: string
) {
  const config: any = {
    systemInstruction: systemPrompt,
    maxOutputTokens: maxTokens,
    responseMimeType: "application/json",
  };

  const response = await withModelFallback(
    (m) =>
      ai.models.generateContent({
        model: m,
        contents: [{ role: "user", parts: [{ text: userContent }] }],
        config,
      }),
    model
  );

  try {
    return JSON.parse(response.text || "{}");
  } catch {
    console.error("Failed to parse JSON from Gemini:", response.text);
    return {};
  }
}

export { DEFAULT_MODEL, MODEL_CHAIN };
