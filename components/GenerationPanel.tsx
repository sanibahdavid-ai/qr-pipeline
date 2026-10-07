"use client";

import { Copy, Check, Lock, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { LanguageRow } from "./LanguageRow";
import type { Provider, AudioState } from "../types";

const LANGS = ["FR", "EN", "DE", "ES"] as const;
type LangCode = (typeof LANGS)[number];

const OTHER_PROVIDERS: { id: Provider; label: string }[] = [
  { id: "ai33-elevenlabs",  label: "AI33 ElevenLabs" },
  { id: "ai33-minimax",     label: "Minimax" },
  { id: "edge-tts",         label: "Edge TTS" },
  { id: "google-tts",       label: "Google Cloud" },
  { id: "google-ai-studio", label: "Google AI Studio" },
];

type Props = {
  provider: Provider;
  onProviderChange: (p: Provider) => void;
  audio: Record<string, AudioState>;
  onGenerate: (lang: LangCode, voice: string, speed: number, modelId?: string, geminiParams?: { style: string; pace: string; accent: string }) => void;
  onGenerateAll: () => void;
  onCopyAllQR: () => void;
  disabled?: boolean;
  audioEnabled?: boolean;
};

export function GenerationPanel({
  provider, onProviderChange,
  audio, onGenerate, onGenerateAll, onCopyAllQR,
  disabled, audioEnabled,
}: Props) {
  const [copiedAll, setCopiedAll] = useState(false);

  function handleCopyAll() {
    onCopyAllQR();
    setCopiedAll(true);
    toast.success("Les 13 sections sont copiées");
    setTimeout(() => setCopiedAll(false), 2000);
  }

  function getAudioKey(lang: LangCode): string {
    if (provider === "edge-tts") return `EDGE_${lang}`;
    if (provider === "google-tts") return `GTTS_${lang}`;
    if (provider === "google-ai-studio") return `GEMINI_${lang}`;
    return lang;
  }

  const anyLoading = LANGS.some((lang) => audio[getAudioKey(lang)]?.status === "loading");
  const isDirect = provider === "elevenlabs";

  return (
    <section className="rounded-[24px] bg-deck border border-line-soft">
      {/* En-tête : titre + moteur */}
      <div className="px-5 sm:px-6 pt-5 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-display text-[26px] font-semibold leading-none">Voix off</h2>
          <p className="text-[14px] text-dim mt-1.5">Une piste par langue, générée à partir du script affiché plus bas.</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onProviderChange("elevenlabs")}
            className={`h-10 px-4 rounded-full text-[14px] font-semibold transition-colors ${
              isDirect
                ? "bg-accent/15 text-accent-hi shadow-[inset_0_0_0_1px_rgba(76,141,255,0.45)]"
                : "text-muted hover:text-fg bg-raised"
            }`}
          >
            ElevenLabs Direct
          </button>
          <select
            value={isDirect ? "" : provider}
            onChange={(e) => { if (e.target.value) onProviderChange(e.target.value as Provider); }}
            className={`dav-select h-10 pl-4 rounded-full text-[14px] font-medium focus:outline-none cursor-pointer transition-colors ${
              isDirect ? "bg-raised text-muted" : "bg-accent/15 text-accent-hi"
            }`}
            title="Autres moteurs vocaux"
            aria-label="Autres moteurs vocaux"
          >
            <option value="">Autres moteurs</option>
            {OTHER_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>

      {!audioEnabled && (
        <div className="mx-5 sm:mx-6 mb-3 flex items-center gap-3 px-4 py-3 rounded-2xl bg-raised/70 text-[14px] text-muted">
          <Lock size={16} className="shrink-0 text-dim" />
          La génération audio est réservée au profil directeur.
        </div>
      )}

      {/* Une ligne par langue */}
      <div className="px-2 sm:px-3 pb-2">
        {LANGS.map((lang) => (
          <LanguageRow
            key={lang}
            lang={lang}
            provider={provider}
            audioState={audio[getAudioKey(lang)]}
            onGenerate={onGenerate}
            audioEnabled={audioEnabled}
          />
        ))}
      </div>

      {/* Actions globales */}
      <div className="px-5 sm:px-6 py-4 border-t border-line-soft flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5">
        <button
          onClick={handleCopyAll}
          disabled={disabled}
          className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-[14px] text-[15px] font-medium text-muted bg-raised hover:text-fg hover:bg-hover disabled:opacity-40 transition-colors"
        >
          {copiedAll ? <Check size={16} className="text-ok" /> : <Copy size={16} />}
          {copiedAll ? "Copié" : "Tout copier (QR)"}
        </button>
        <button
          onClick={onGenerateAll}
          disabled={disabled || anyLoading || !audioEnabled}
          className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-[14px] text-[15px] font-semibold bg-accent-deep text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] hover:bg-accent disabled:bg-raised disabled:text-dim disabled:shadow-none disabled:cursor-not-allowed transition-colors"
        >
          <Sparkles size={16} />
          Générer les 4 langues
        </button>
      </div>
    </section>
  );
}
