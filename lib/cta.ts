export const RONALDO_CTA_TEXTS: Record<string, string> = {
  FR: "En passant, savais-tu que Cristiano sourit quand tu tapes sur le bouton plus ?",
  EN: "By the way, did you know Cristiano smiles when you tap the plus button?",
  DE: "Übrigens, wusstest du, dass Cristiano lächelt, wenn du auf Plus tippst?",
  ES: "Por cierto, ¿sabías que Cristiano sonríe cuando tocas el botón plus?",
};

export const TIKTOK_CTA_TEXTS: Record<string, string> = {
  FR: "Si tu es fan de ce genre d'histoires football, suis-nous dès maintenant, car TikTok risque de ne plus te montrer notre prochain chef-d'œuvre si tu ne le fais pas.",
  EN: "If you're impressed by football stories like this one, follow us right now, because TikTok might not show you our next masterpiece if you don't.",
  DE: "Wenn dir solche Fußball-Geschichten gefallen, folge uns jetzt, denn TikTok könnte dir unser nächstes Meisterwerk sonst nicht mehr zeigen.",
  ES: "Si te gustan este tipo de historias del fútbol, síguenos ahora mismo, porque TikTok podría no mostrarte nuestra próxima obra maestra si no lo haces.",
};

// Lowercase, accents and punctuation removed, so auto-captions ("savais tu",
// "sabias") match the canonical text ("savais-tu", "¿sabías").
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Recognises the site's own CTAs and the source videos' keyboard CTAs in any of
// the four languages, however they were transcribed or reworded.
export function isCtaSentence(sentence: string): boolean {
  const n = ` ${normalize(sentence)} `;
  const ronaldo = n.includes(" cristiano ") &&
    /\b(sourit|smiles?|lachelt|sonrie)\b/.test(n) &&
    /\bplus\b/.test(n);
  const tiktok = n.includes(" tiktok ") &&
    /\b(chef d oeuvre|masterpiece|meisterwerk|obra maestra)\b/.test(n);
  const keyboard = /\b(ton clavier|your keyboard|deine tastatur|tu teclado)\b/.test(n) ||
    /\blet it finish\b/.test(n);
  return ronaldo || tiktok || keyboard;
}

export function splitSentences(text: string): string[] {
  const parts: string[] = [];
  let pos = 0;
  const re = /[.!?…]+["»”)]?\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const chunk = text.slice(pos, m.index + m[0].length).trim();
    if (chunk) parts.push(chunk);
    pos = m.index + m[0].length;
  }
  if (pos < text.length) {
    const tail = text.slice(pos).trim();
    if (tail) parts.push(tail);
  }
  return parts;
}

// A CTA is one short sentence. Above this, a "sentence" is really an
// unpunctuated caption run-on, and dropping it whole would delete the story.
const MAX_CTA_WORDS = 35;

function isShortCtaSentence(sentence: string): boolean {
  return sentence.split(/\s+/).length <= MAX_CTA_WORDS && isCtaSentence(sentence);
}

// Removes just the CTA span inside a run-on, tolerating missing accents,
// hyphens and punctuation ("savais tu", "sabias", "ubrigens").
const CTA_SPANS = [
  /(?:(?:en passant|by the way|[üu]brigens|por cierto)[\s,]*)?¿?\s*(?:savais[\s-]*tu|did you know|wusstest du|sab[ií]as)[^.?!]{0,60}?cristiano[^.?!]{0,60}?\bplus\b(?:\s*(?:button|tippst))?\s*[?.!]?/giu,
  /(?:savais[\s-]*tu|did you know)[^.?!]{0,40}?(?:ton clavier|your keyboard)[^.?!]*[?.!]?/giu,
  /type\s+\w+\s+and let it finish[^.?!]*[?.!]?/giu,
];

export function stripCtaSentences(text: string): string {
  let out = splitSentences(text).filter((s) => !isShortCtaSentence(s)).join(" ");
  for (const re of CTA_SPANS) out = out.replace(re, " ");
  return out.replace(/\s{2,}/g, " ").trim();
}

// Keeps the first CTA sentence and drops any later one.
export function dedupeCta(text: string): string {
  let seen = false;
  return splitSentences(text)
    .filter((s) => {
      if (!isShortCtaSentence(s)) return true;
      if (seen) return false;
      seen = true;
      return true;
    })
    .join(" ");
}
