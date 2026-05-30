export type Provider = "ai33-minimax" | "ai33-elevenlabs" | "elevenlabs" | "edge-tts" | "google-tts";

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
] as const;

export type Section = (typeof SECTIONS)[number];

export type AudioState = {
  status: "loading" | "done" | "error";
  label: string;
  audioUrl?: string;
  filename?: string;
};

export type Step = "idle" | "extracting" | "transcript" | "rewriting" | "done";
export type DurationSelection = "15s" | "30s" | "60s" | "custom" | "original";

export type HistoryEntry = {
  id: string;
  date: string;
  title: string;
  url: string;
  qrText: string;
  provider: Provider;
};
