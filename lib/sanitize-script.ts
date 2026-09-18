// The rewrite prompt forbids dashes-as-punctuation and a fixed list of
// intensifiers, but the model breaks those rules intermittently. These passes
// enforce them deterministically on the way out.

// Replacements are picked to survive substitution blindly:
// - FR/ES adjectives are invariable, so gender and number can't disagree
// - EN replacements start with a vowel like the words they replace, so a
//   preceding "an" stays correct
// - "locura" is a feminine noun, so it needs a feminine noun back
// - each banned word maps to a distinct term, so two in one sentence don't
//   collapse into the same word twice
const BANNED_WORDS: Record<string, string> = {
  incroyable: "remarquable",
  dingue: "spectaculaire",
  fou: "formidable",
  amazing: "outstanding",
  insane: "extraordinary",
  unbelievable: "astonishing",
  incredible: "exceptional",
  wahnsinnig: "außergewöhnlich",
  unglaublich: "bemerkenswert",
  increíble: "excepcional",
  locura: "hazaña",
  impresionante: "formidable",
};

const BANNED_RE = new RegExp(`\\b(${Object.keys(BANNED_WORDS).join("|")})\\b`, "gi");

function matchCase(replacement: string, original: string): string {
  if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

export function sanitizeScript(text: string): string {
  return text
    // Dash used as punctuation (surrounded by whitespace) becomes a comma.
    // Hyphens inside words (dix-huit, Al-Nassr) are left alone.
    .replace(/\s+[—–-]\s+/g, ", ")
    // Em/en dash hugging a word still reads as punctuation here.
    .replace(/[—–]/g, ", ")
    .replace(/\s+,/g, ",")
    .replace(/,{2,}/g, ",")
    .replace(BANNED_RE, (m) => matchCase(BANNED_WORDS[m.toLowerCase()], m));
}

// Longest banned word + padding, so a term never straddles two emitted chunks.
const TAIL = 32;

// Largest index <= limit that sits on whitespace, so the emitted prefix never
// ends mid-word — a split term ("incred" | "ible") matches neither half. Backs
// up once more when the prefix would end on a dash, since the dash rule needs
// the whitespace on both sides to be present together. Returns -1 when there is
// no safe point yet and the caller should keep buffering.
function safeCut(text: string, limit: number): number {
  let cut = Math.min(limit, text.length - 1);
  while (cut > 0 && !/\s/.test(text[cut])) cut--;
  while (cut > 0 && /[—–-]/.test(text.slice(0, cut).trimEnd().slice(-1))) {
    cut--;
    while (cut > 0 && !/\s/.test(text[cut])) cut--;
  }
  return cut > 0 ? cut : -1;
}

// Wraps a text stream, sanitizing content while still streaming. Emits only up
// to a whitespace boundary at least TAIL characters back, so no term is ever
// split across two emitted chunks.
export function sanitizeStream(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new ReadableStream({
    async start(controller) {
      const reader = source.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > TAIL * 2) {
            const cut = safeCut(buffer, buffer.length - TAIL);
            if (cut > 0) {
              controller.enqueue(encoder.encode(sanitizeScript(buffer.slice(0, cut))));
              buffer = buffer.slice(cut);
            }
          }
        }
        if (buffer) controller.enqueue(encoder.encode(sanitizeScript(buffer)));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}
