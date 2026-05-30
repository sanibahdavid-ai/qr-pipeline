"use client";

import { useState, useEffect, useCallback } from "react";
import type { Provider } from "../types";

type VoiceConfig = {
  voice: string;
  speed: number;
};

const DEFAULTS: Record<Provider, Record<string, VoiceConfig>> = {
  "ai33-minimax":    { FR: { voice: "273587280617675", speed: 1.0 }, EN: { voice: "273587280617675", speed: 1.0 }, DE: { voice: "273587280617675", speed: 1.0 }, ES: { voice: "273587280617675", speed: 1.0 } },
  "ai33-elevenlabs": { FR: { voice: "aTTiK3YzK3dXETpuDE2h", speed: 1.0 }, EN: { voice: "aTTiK3YzK3dXETpuDE2h", speed: 1.0 }, DE: { voice: "aTTiK3YzK3dXETpuDE2h", speed: 1.0 }, ES: { voice: "aTTiK3YzK3dXETpuDE2h", speed: 1.0 } },
  "elevenlabs":      { FR: { voice: "aTTiK3YzK3dXETpuDE2h", speed: 1.0 }, EN: { voice: "aTTiK3YzK3dXETpuDE2h", speed: 1.0 }, DE: { voice: "aTTiK3YzK3dXETpuDE2h", speed: 1.0 }, ES: { voice: "aTTiK3YzK3dXETpuDE2h", speed: 1.0 } },
  "edge-tts":        { FR: { voice: "fr-FR-HenriNeural", speed: 0 }, EN: { voice: "en-US-GuyNeural", speed: 0 }, DE: { voice: "de-DE-KillianNeural", speed: 0 }, ES: { voice: "es-ES-AlvaroNeural", speed: 0 } },
  "google-tts":      { FR: { voice: "fr-FR-Neural2-B", speed: 1.0 }, EN: { voice: "en-US-Neural2-D", speed: 1.0 }, DE: { voice: "de-DE-Neural2-B", speed: 1.0 }, ES: { voice: "es-ES-Neural2-B", speed: 1.0 } },
};

const STORAGE_KEY = "qr_voice_config_v2";

type AllConfigs = Partial<Record<string, VoiceConfig>>;

export function useVoiceConfig(provider: Provider, lang: string) {
  const key = `${provider}__${lang}`;

  const [config, setConfig] = useState<VoiceConfig>(() => {
    return DEFAULTS[provider]?.[lang] ?? { voice: "", speed: 1.0 };
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const all = JSON.parse(raw) as AllConfigs;
        const saved = all[key];
        if (saved?.voice !== undefined) {
          setConfig((prev) => ({ ...prev, ...saved }));
        }
      }
    } catch {}
  }, [key]);

  const update = useCallback((patch: Partial<VoiceConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
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
