"use client";

import { Copy, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { LanguageRow } from "./LanguageRow";
import type { Provider, AudioState, Section } from "../types";

const LANGS = ["FR", "EN", "DE", "ES"] as const;
type LangCode = (typeof LANGS)[number];

const PROVIDERS_UI: { id: Provider; label: string; group: string }[] = [
  { id: "ai33-elevenlabs",  label: "AI33 — ElevenLabs", group: "AI33" },
  { id: "ai33-minimax",     label: "Minimax",           group: "AI33" },
  { id: "elevenlabs",       label: "ElevenLabs Direct", group: "Direct" },
  { id: "edge-tts",         label: "Edge TTS",          group: "Free" },
  { id: "google-tts",       label: "Google Cloud",      group: "Free" },
  { id: "google-ai-studio", label: "Google AI Studio",  group: "Free" },
];

const DURATION_OPTIONS = ["10s", "15s", "30s", "45s", "1min30", "2min"] as const;
type DurationOption = (typeof DURATION_OPTIONS)[number];

type Props = {
  provider: Provider;
  onProviderChange: (p: Provider) => void;
  targetDuration: DurationOption | "original";
  onDurationChange: (d: DurationOption | "original") => void;
  customSeconds: number | null;
  onCustomSecondsChange: (s: number | null) => void;
  audio: Record<string, AudioState>;
  onGenerate: (lang: LangCode, voice: string, speed: number, modelId?: string, geminiParams?: { style: string; pace: string; accent: string }) => void;
  onGenerateAll: () => void;
  onCopyAllQR: () => void;
  disabled?: boolean;
  isProduction?: boolean;
};

export function GenerationPanel({
  provider, onProviderChange,
  targetDuration, onDurationChange,
  customSeconds, onCustomSecondsChange,
  audio, onGenerate, onGenerateAll, onCopyAllQR,
  disabled, isProduction,
}: Props) {
  const [copiedAll, setCopiedAll] = useState(false);
  const [customInput, setCustomInput] = useState("");

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
    audio["ES"]?.status === "loading" ||
    audio["EDGE_FR"]?.status === "loading" ||
    audio["EDGE_EN"]?.status === "loading" ||
    audio["EDGE_DE"]?.status === "loading" ||
    audio["EDGE_ES"]?.status === "loading" ||
    audio["GTTS_FR"]?.status === "loading" ||
    audio["GTTS_EN"]?.status === "loading" ||
    audio["GTTS_DE"]?.status === "loading" ||
    audio["GTTS_ES"]?.status === "loading" ||
    audio["GEMINI_FR"]?.status === "loading" ||
    audio["GEMINI_EN"]?.status === "loading" ||
    audio["GEMINI_DE"]?.status === "loading" ||
    audio["GEMINI_ES"]?.status === "loading";

  function getAudioKey(lang: LangCode): string {
    if (provider === "edge-tts") return `EDGE_${lang}`;
    if (provider === "google-tts") return `GTTS_${lang}`;
    if (provider === "google-ai-studio") return `GEMINI_${lang}`;
    return lang;
  }

  return (
    <div className="border border-[#1a2e25] bg-[#0d1512] overflow-hidden" style={{ borderRadius: "4px" }}>
      {/* Gradient top bar */}
      <div className="h-[2px] w-full" style={{ background: "linear-gradient(90deg, #00e5a0, #ff3cac)" }} />

      {/* Provider selector */}
      <div className="px-4 pt-4 pb-3 border-b border-[#1a2e25]">
        <div className="flex items-stretch gap-1 flex-wrap">
          {groups.map((group, gi) => (
            <div key={group} className="flex items-center gap-1">
              {gi > 0 && <div className="w-px h-5 bg-[#1a2e25] mx-1" />}
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-mono text-[#4a6a58] uppercase tracking-widest px-1">{group}</span>
                <div className="flex gap-1">
                  {PROVIDERS_UI.filter((p) => p.group === group).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => onProviderChange(p.id)}
                      className={`px-2.5 py-1 text-[11px] font-mono font-medium transition-none ${
                        provider === p.id
                          ? "text-black"
                          : "text-[#8aaa98] hover:text-[#e0f0e8] hover:bg-[#121f19]"
                      }`}
                      style={{
                        borderRadius: "2px",
                        background: provider === p.id ? "linear-gradient(135deg, #00e5a0, #00b4d8)" : undefined,
                      }}
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
      <div className="px-4 py-3 border-b border-[#1a2e25]">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[9px] font-mono text-[#4a6a58] uppercase tracking-widest mr-2">Durée</span>
          {([...DURATION_OPTIONS, "original"] as const).map((d) => (
            <button
              key={d}
              onClick={() => {
                onDurationChange(d as DurationOption | "original");
                setCustomInput("");
                onCustomSecondsChange(null);
              }}
              className={`px-2.5 py-0.5 text-[11px] font-mono border transition-none ${
                targetDuration === d && customSeconds === null
                  ? "text-black border-[#00e5a0]"
                  : "bg-transparent border-[#1a2e25] text-[#8aaa98] hover:border-[#223a2f] hover:text-[#e0f0e8]"
              }`}
              style={{
                borderRadius: "2px",
                background: targetDuration === d && customSeconds === null ? "linear-gradient(135deg, #00e5a0, #00b4d8)" : undefined,
              }}
            >
              {d === "original" ? "Original" : d}
            </button>
          ))}
          <div className="w-px h-4 bg-[#1a2e25] mx-1" />
          <input
            type="number"
            min="1"
            placeholder="sec"
            value={customInput}
            onChange={(e) => {
              const val = e.target.value;
              setCustomInput(val);
              const parsed = parseInt(val, 10);
              if (val === "" || isNaN(parsed) || parsed <= 0) {
                onCustomSecondsChange(null);
              } else {
                onCustomSecondsChange(parsed);
              }
            }}
            className="w-14 px-2 py-0.5 text-[11px] font-mono bg-[#080e0c] border border-[#1a2e25] text-[#8aaa98] outline-none transition-none"
            style={{
              borderRadius: "2px",
              fontFamily: "var(--font-space-mono, monospace)",
              borderColor: customSeconds !== null ? "#00e5a0" : undefined,
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "#00e5a0"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = customSeconds !== null ? "#00e5a0" : "#1a2e25"; }}
          />
        </div>
      </div>

      {/* Language rows */}
      <div className="px-4 py-2 divide-y divide-[#1a2e25]">
        {LANGS.map((lang) => (
          <LanguageRow
            key={lang}
            lang={lang}
            provider={provider}
            audioState={audio[getAudioKey(lang)]}
            onGenerate={onGenerate}
            isProduction={isProduction}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[#1a2e25] flex items-center justify-between gap-3">
        <button
          onClick={onGenerateAll}
          disabled={disabled || anyLoading || isProduction}
          title={isProduction ? "Available in local version only" : undefined}
          className={`flex-1 py-2 text-[11px] font-bold tracking-[2px] uppercase disabled:opacity-40 transition-none ${
            isProduction ? "cursor-not-allowed text-[#4a6a58]" : "text-black"
          }`}
          style={{
            fontFamily: "var(--font-syne)",
            background: isProduction ? "#1a2e25" : "linear-gradient(135deg, #00e5a0, #00b4d8)",
            borderRadius: "2px",
          }}
        >
          Générer les 4 langues
        </button>
        <button
          onClick={handleCopyAll}
          disabled={disabled}
          className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono border border-[#1a2e25] text-[#8aaa98] hover:border-[#00e5a0] hover:text-[#00e5a0] disabled:opacity-40 transition-none"
          style={{ borderRadius: "2px" }}
        >
          {copiedAll ? <Check size={11} /> : <Copy size={11} />}
          {copiedAll ? "Copié !" : "Tout (QR)"}
        </button>
      </div>
    </div>
  );
}
