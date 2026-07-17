export const GEMINI_TTS_VOICES: { id: string; label: string }[] = [
  { id: "Schedar", label: "Schedar — Even, Lower middle pitch ★" },
  { id: "Achernar", label: "Achernar — Soft, Higher pitch" },
  { id: "Achird", label: "Achird — Friendly, Lower pitch" },
  { id: "Algenib", label: "Algenib — Gravelly, Lower pitch" },
  { id: "Algieba", label: "Algieba — Smooth, Lower pitch" },
  { id: "Alnilam", label: "Alnilam — Firm, Lower middle pitch" },
  { id: "Rasalgethi", label: "Rasalgethi — Informative, Middle pitch" },
  { id: "Sadachbia", label: "Sadachbia — Lively, Lower middle pitch" },
  { id: "Sadaltager", label: "Sadaltager — Knowledgeable, Middle pitch" },
  { id: "Sulafat", label: "Sulafat — Warm, Middle pitch" },
  { id: "Umbriel", label: "Umbriel — Easy-going, Lower middle pitch" },
  { id: "Vindemiatrix", label: "Vindemiatrix — Gentle, Middle pitch" },
  { id: "Zephyr", label: "Zephyr — Bright, Higher pitch" },
  { id: "Zubenelgenubi", label: "Zubenelgenubi — Casual, Lower middle pitch" },
];

export const GEMINI_STYLES = [
  "Promo/Hype",
  "Narrative",
  "Conversational",
  "Newscast",
  "Calm",
  "Excited",
] as const;

export const GEMINI_PACES = ["Rapid Fire", "Normal", "Slow", "Fast"] as const;

export const GEMINI_ACCENTS = ["Neutral", "American", "British", "Australian"] as const;

export const GEMINI_VOICE_DEFAULT = "Schedar";
export const GEMINI_STYLE_DEFAULT = "Promo/Hype";
export const GEMINI_PACE_DEFAULT = "Rapid Fire";
export const GEMINI_ACCENT_DEFAULT = "Neutral";
