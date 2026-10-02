"use client";

import { useState, useEffect, useCallback } from "react";
import type { Provider } from "../types";

export type VoiceConfig = {
  voice: string;
  speed: number;
  style?: string;
  pace?: string;
  accent?: string;
};

const DEFAULTS: Record<Provider, Record<string, VoiceConfig>> = {
  "ai33-minimax":    { FR: { voice: "clone_2580971", speed: 1.0 }, EN: { voice: "clone_2608233", speed: 1.0 }, DE: { voice: "clone_2608233", speed: 1.0 }, ES: { voice: "clone_2608233", speed: 1.0 } },
  "ai33-elevenlabs": { FR: { voice: "elevenlabs_6DsgX00trsI64jl83WWS", speed: 1.0 }, EN: { voice: "elevenlabs_6DsgX00trsI64jl83WWS", speed: 1.0 }, DE: { voice: "elevenlabs_6DsgX00trsI64jl83WWS", speed: 1.0 }, ES: { voice: "elevenlabs_6DsgX00trsI64jl83WWS", speed: 1.0 } },
  "elevenlabs":      { FR: { voice: "6DsgX00trsI64jl83WWS", speed: 1.0 }, EN: { voice: "6DsgX00trsI64jl83WWS", speed: 1.0 }, DE: { voice: "6DsgX00trsI64jl83WWS", speed: 1.0 }, ES: { voice: "6DsgX00trsI64jl83WWS", speed: 1.0 } },
  "edge-tts":        { FR: { voice: "fr-FR-HenriNeural", speed: 0 }, EN: { voice: "en-US-GuyNeural", speed: 0 }, DE: { voice: "de-DE-KillianNeural", speed: 0 }, ES: { voice: "es-ES-AlvaroNeural", speed: 0 } },
  "google-tts":      { FR: { voice: "fr-FR-Neural2-B", speed: 1.0 }, EN: { voice: "en-US-Neural2-D", speed: 1.0 }, DE: { voice: "de-DE-Neural2-B", speed: 1.0 }, ES: { voice: "es-ES-Neural2-B", speed: 1.0 } },
  "google-ai-studio": {
    FR: { voice: "Schedar", speed: 1.0, style: "Promo/Hype", pace: "Rapid Fire", accent: "Neutral" },
    EN: { voice: "Schedar", speed: 1.0, style: "Promo/Hype", pace: "Rapid Fire", accent: "Neutral" },
    DE: { voice: "Schedar", speed: 1.0, style: "Promo/Hype", pace: "Rapid Fire", accent: "Neutral" },
    ES: { voice: "Schedar", speed: 1.0, style: "Promo/Hype", pace: "Rapid Fire", accent: "Neutral" },
  },
};

// Bumped to v7: new default voice is Alex Upbeat (ElevenLabs) for AI33/Direct, plus new Google AI Studio provider
export const VOICE_CONFIG_STORAGE_KEY = "qr_voice_config_v7";
const STORAGE_KEY = VOICE_CONFIG_STORAGE_KEY;

type AllConfigs = Partial<Record<string, VoiceConfig>>;

// Hard ceiling across every provider: ElevenLabs/AI33 top out at 1.5, so a
// stored or computed value above that (stale localStorage, an old slider
// range) is clamped down rather than replayed as-is.
const SPEED_FLOOR = 0.5;
const SPEED_CEILING = 1.5;
export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1.0;
  return Math.min(SPEED_CEILING, Math.max(SPEED_FLOOR, speed));
}

export function useVoiceConfig(provider: Provider, lang: string) {
  const key = `${provider}__${lang}`;

  const [config, setConfig] = useState<VoiceConfig>(() => {
    return DEFAULTS[provider]?.[lang] ?? { voice: "", speed: 1.0 };
  });

  useEffect(() => {
    const fallback = DEFAULTS[provider]?.[lang] ?? { voice: "", speed: 1.0 };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const saved = raw ? (JSON.parse(raw) as AllConfigs)[key] : undefined;
      setConfig(saved?.voice !== undefined ? { ...saved, speed: clampSpeed(saved.speed) } : fallback);
    } catch {
      setConfig(fallback);
    }
  }, [key, provider, lang]);

  const update = useCallback((patch: Partial<VoiceConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      if (next.speed !== undefined) next.speed = clampSpeed(next.speed);
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const all: AllConfigs = raw ? JSON.parse(raw) : {};
        all[key] = next;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      } catch {}
      return next;
    });
  }, [key]);

  return { config, update };
}
