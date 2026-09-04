export type Provider = "ai33-minimax" | "ai33-elevenlabs" | "elevenlabs" | "edge-tts" | "google-tts" | "google-ai-studio";

export const SECTIONS = [
  "SCRIPT FR",
  "SCRIPT EN",
  "SCRIPT DE",
  "SCRIPT ES",
  "SEARCH KEYWORDS EN",
  "TITRE ET HASHTAGS FR",
  "TITRE ET HASHTAGS EN",
  "TITRE ET HASHTAGS DE",
  "TITRE ET HASHTAGS ES",
  "TITRE ET HASHTAGS FR B",
  "TITRE ET HASHTAGS EN B",
  "TITRE ET HASHTAGS DE B",
  "TITRE ET HASHTAGS ES B",
] as const;

export type Section = (typeof SECTIONS)[number];

export type AudioState = {
  status: "loading" | "done" | "error";
  label: string;
  audioUrl?: string;
  originalUrl?: string;
  filename?: string;
};

export type Step = "idle" | "extracting" | "transcript" | "rewriting" | "done";
export type DurationSelection = "15s" | "30s" | "60s" | "custom" | "original";

export type HistoryEntry = {
  id: string;
  createdAt: string;
  title: string;
  url: string;
  qrText: string;
  provider: Provider;
  step: "done";
  transcriptText?: string;
  healthScores?: Record<string, number>;
};

export type UserRole = "DAV" | "ADMIN" | "GUEST" | null;

export type AuthUser = {
  id: string;
  email?: string;
  user_metadata: {
    avatar_url?: string;
    picture?: string;
    full_name?: string;
    name?: string;
  };
  role?: UserRole;
};
