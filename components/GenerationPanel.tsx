"use client";

import { Copy, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { LanguageRow } from "./LanguageRow";
import type { Provider, AudioState, Section } from "../types";

const LANGS = ["FR", "EN", "DE"] as const;
type LangCode = (typeof LANGS)[number];

const PROVIDERS_UI: { id: Provider; label: string; group: string }[] = [
  { id: "ai33-minimax",    label: "Minimax",      group: "AI33" },
  { id: "ai33-elevenlabs", label: "ElevenLabs",   group: "AI33" },
  { id: "elevenlabs",      label: "ElevenLabs",   group: "Direct" },
  { id: "edge-tts",        label: "Edge TTS",     group: "Free" },
  { id: "google-tts",      label: "Google Cloud", group: "Free" },
];

const DURATION_OPTIONS = ["10s", "15s", "30s", "45s", "1min", "1min30", "2min"] as const;
type DurationOption = (typeof DURATION_OPTIONS)[number];

type Props = {
  provider: Provider;
  onProviderChange: (p: Provider) => void;
  targetDuration: DurationOption | "original";
  onDurationChange: (d: DurationOption | "original") => void;
  audio: Record<string, AudioState>;
  onGenerate: (lang: LangCode, voice: string, speed: number) => void;
  onGenerateAll: () => void;
  onCopyAllQR: () => void;
  disabled?: boolean;
};

export function GenerationPanel({
  provider, onProviderChange,
  targetDuration, onDurationChange,
  audio, onGenerate, onGenerateAll, onCopyAllQR,
  disabled,
}: Props) {
  const [copiedAll, setCopiedAll] = useState(false);

  const groups = ["AI33", "Direct", "Free"];

  function handleCopyAll() {
    onCopyAllQR();
    setCopiedAll(true);
    toast.success("QR copié dans le presse-papier");
    setTimeout(() => setCopiedAll(false), 2000);
  }

  const anyLoading =
    audio["FR"]?.status === "loading" ||
    audio["EN"]?.status === "loading" ||
    audio["DE"]?.status === "loading" ||
    audio["EDGE_FR"]?.status === "loading" ||
    audio["EDGE_EN"]?.status === "loading" ||
    audio["EDGE_DE"]?.status === "loading" ||
    audio["GTTS_FR"]?.status === "loading" ||
    audio["GTTS_EN"]?.status === "loading" ||
    audio["GTTS_DE"]?.status === "loading";

  function getAudioKey(lang: LangCode): string {
    if (provider === "edge-tts") return `EDGE_${lang}`;
    if (provider === "google-tts") return `GTTS_${lang}`;
    return lang;
  }

  return (
    <div
      className="border border-[#262626] bg-[#141414] overflow-hidden"
      style={{ borderRadius: "8px" }}
    >
      {/* Provider selector */}
      <div className="px-4 pt-4 pb-3 border-b border-[#262626]">
        <div className="flex items-stretch gap-1 flex-wrap">
          {groups.map((group, gi) => (
            <div key={group} className="flex items-center gap-1">
              {gi > 0 && <div className="w-px h-5 bg-[#262626] mx-1" />}
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-mono text-[#525252] uppercase tracking-widest px-1">{group}</span>
                <div className="flex gap-1">
                  {PROVIDERS_UI.filter((p) => p.group === group).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => onProviderChange(p.id)}
                      className={`px-2.5 py-1 text-[11px] font-mono font-medium transition-none ${
                        provider === p.id
                          ? "bg-[#F5F5F5] text-[#0A0A0A]"
                          : "text-[#A3A3A3] hover:text-[#F5F5F5] hover:bg-[#1C1C1C]"
                      }`}
                      style={{ borderRadius: "4px" }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Duration selector */}
      <div className="px-4 py-3 border-b border-[#262626]">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[9px] font-mono text-[#525252] uppercase tracking-widest mr-2">Durée</span>
          {([...DURATION_OPTIONS, "original"] as const).map((d) => (
            <button
              key={d}
              onClick={() => onDurationChange(d as DurationOption | "original")}
              className={`px-2.5 py-0.5 text-[11px] font-mono border transition-none ${
                targetDuration === d
                  ? "bg-[#F5F5F5] text-[#0A0A0A] border-[#F5F5F5]"
                  : "bg-transparent border-[#262626] text-[#A3A3A3] hover:border-[#404040] hover:text-[#F5F5F5]"
              }`}
              style={{ borderRadius: "4px" }}
            >
              {d === "original" ? "Original" : d}
            </button>
          ))}
        </div>
      </div>

      {/* Language rows */}
      <div className="px-4 py-2 divide-y divide-[#262626]">
        {LANGS.map((lang) => (
          <LanguageRow
            key={lang}
            lang={lang}
            provider={provider}
            audioState={audio[getAudioKey(lang)]}
            onGenerate={onGenerate}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[#262626] flex items-center justify-between gap-3">
        <button
          onClick={onGenerateAll}
          disabled={disabled || anyLoading}
          className="flex-1 py-2 text-[11px] font-mono font-semibold border border-[#F5F5F5] bg-[#F5F5F5] text-[#0A0A0A] hover:bg-transparent hover:text-[#F5F5F5] disabled:opacity-40 transition-none"
          style={{ borderRadius: "4px" }}
        >
          Générer les 3 langues
        </button>
        <button
          onClick={handleCopyAll}
          disabled={disabled}
          className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono border border-[#262626] text-[#A3A3A3] hover:border-[#404040] hover:text-[#F5F5F5] disabled:opacity-40 transition-none"
          style={{ borderRadius: "4px" }}
        >
          {copiedAll ? <Check size={11} /> : <Copy size={11} />}
          {copiedAll ? "Copié !" : "Tout (QR)"}
        </button>
      </div>
    </div>
  );
}
