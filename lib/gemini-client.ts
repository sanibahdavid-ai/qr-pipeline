import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const DEFAULT_MODEL = "gemini-3.6-flash";

export async function geminiStream(
  systemPrompt: string,
  userContent: string,
  maxTokens: number = 10000,
  model: string = DEFAULT_MODEL,
  imageBase64?: string
) {
  const config: any = {
    systemInstruction: systemPrompt,
    maxOutputTokens: maxTokens,
  };

  const parts: any[] = [];
  if (imageBase64) {
    const mimeType = imageBase64.startsWith("/") ? "image/jpeg" : imageBase64.startsWith("iVBORw") ? "image/png" : "image/jpeg";
    parts.push({
      inlineData: {
        data: imageBase64,
        mimeType: mimeType
      }
    });
  }
  parts.push({ text: userContent });

  const responseStream = await ai.models.generateContentStream({
    model: model,
    contents: parts,
    config: config,
  });

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of responseStream) {
          const text = chunk.text;
          if (text) {
            controller.enqueue(new TextEncoder().encode(text));
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    }
  });
}

export async function geminiCreate(
  systemPrompt: string,
  userContent: string,
  maxTokens: number = 10000,
  model: string = DEFAULT_MODEL,
  imageBase64?: string
) {
  const config: any = {
    systemInstruction: systemPrompt,
    maxOutputTokens: maxTokens,
  };

  const parts: any[] = [];
  if (imageBase64) {
    const mimeType = imageBase64.startsWith("/") ? "image/jpeg" : imageBase64.startsWith("iVBORw") ? "image/png" : "image/jpeg";
    parts.push({
      inlineData: {
        data: imageBase64,
        mimeType: mimeType
      }
    });
  }
  parts.push({ text: userContent });

  const response = await ai.models.generateContent({
    model: model,
    contents: parts,
    config: config,
  });

  return { text: response.text || "" };
}

export async function geminiCreateJson(
  systemPrompt: string,
  userContent: string,
  maxTokens: number = 10000,
  model: string = DEFAULT_MODEL
) {
  const config: any = {
    systemInstruction: systemPrompt,
    maxOutputTokens: maxTokens,
    responseMimeType: "application/json",
  };

  const response = await ai.models.generateContent({
    model: model,
    contents: [{ text: userContent }],
    config: config,
  });

  try {
    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("Failed to parse JSON from Gemini:", response.text);
    return {};
  }
}
