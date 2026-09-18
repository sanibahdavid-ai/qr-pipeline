// The rewrite prompt forbids dashes-as-punctuation and a fixed list of
// intensifiers, but the model breaks those rules intermittently. These passes
// enforce them deterministically on the way out.

// Invariable replacements chosen so gender/number agreement can't break.
const BANNED_WORDS: Record<string, string> = {
  incroyable: "remarquable",
  dingue: "spectaculaire",
  fou: "spectaculaire",
  amazing: "remarkable",
  insane: "extraordinary",
  unbelievable: "astonishing",
  incredible: "remarkable",
  wahnsinnig: "außergewöhnlich",
  unglaublich: "bemerkenswert",
  increíble: "excepcional",
  locura: "algo excepcional",
  impresionante: "excepcional",
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

// Wraps a text stream, sanitizing content while still streaming. Holds back the
// last TAIL characters so a word split across chunk boundaries is still matched.
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
          if (buffer.length > TAIL) {
            const emit = buffer.slice(0, buffer.length - TAIL);
            buffer = buffer.slice(buffer.length - TAIL);
            controller.enqueue(encoder.encode(sanitizeScript(emit)));
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
