"use client";

import { Play, RefreshCw, Loader2, Pause, RotateCcw, Download, Check } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import { useVoiceConfig } from "../hooks/useVoiceConfig";
import { SilenceRemoveControls } from "./SilenceRemoveControls";
import type { Provider, AudioState } from "../types";
import { EDGE_TTS_VOICES } from "../lib/edge-tts-voices";
import { GOOGLE_TTS_VOICES } from "../lib/google-tts-voices";
import {
  GEMINI_TTS_VOICES,
  GEMINI_STYLES,
  GEMINI_PACES,
  GEMINI_ACCENTS,
  GEMINI_STYLE_DEFAULT,
  GEMINI_PACE_DEFAULT,
  GEMINI_ACCENT_DEFAULT,
} from "../lib/gemini-tts-voices";

type LangCode = "FR" | "EN" | "DE" | "ES";

const LANG_NAMES: Record<LangCode, string> = {
  FR: "Français",
  EN: "Anglais",
  DE: "Allemand",
  ES: "Espagnol",
};

const EDGE_LANG_MAP: Record<LangCode, keyof typeof EDGE_TTS_VOICES> = {
  FR: "fr", EN: "en", DE: "de", ES: "es",
};
const GOOGLE_LANG_MAP: Record<LangCode, keyof typeof GOOGLE_TTS_VOICES> = {
  FR: "fr", EN: "en", DE: "de", ES: "es",
};

const EDGE_RATE_MIN = -50;
const EDGE_RATE_MAX = 200;
const SPEED_MIN = 0.5;
const SPEED_MAX = 1.5;
const GEMINI_SPEED_MIN = 0.5;
const GEMINI_SPEED_MAX = 1.5;

const AI33_VOICES: { id: string; label: string }[] = [
  { id: "elevenlabs_yl2ZDV1MzN4HbQJbMihG", label: "Alex Upbeat, Energetic and Clear" },
];

const ELEVENLABS_DIRECT_VOICES: { id: string; label: string }[] = [
  { id: "yl2ZDV1MzN4HbQJbMihG", label: "Alex Upbeat, Energetic and Clear" },
];

const EL_MODELS: { id: string; label: string }[] = [
  { id: "eleven_multilingual_v2", label: "Multilingual v2" },
  { id: "eleven_v3",              label: "Eleven v3 (défaut)" },
  { id: "eleven_flash_v2_5",      label: "Flash v2.5" },
];

// Modèles que l'API ElevenLabs expose pour la synthèse vocale (Direct uniquement).
const EL_MODELS_DIRECT: { id: string; label: string }[] = [
  { id: "eleven_v3",              label: "Eleven v3 (défaut)" },
  { id: "eleven_v4",              label: "Eleven v4" },
  { id: "eleven_multilingual_v2", label: "Multilingual v2" },
  { id: "eleven_flash_v2_5",      label: "Flash v2.5" },
];

const EL_MODEL_DEFAULT = "eleven_v3";

// Plages réellement acceptées : ElevenLabs Direct 0.7 à 1.2, AI33 0.5 à 1.5.
const EL_SPEED_MIN_DIRECT = 0.7;
const EL_SPEED_MAX_DIRECT = 1.2;
const EL_SPEED_MIN_AI33 = 0.5;
const EL_SPEED_MAX_AI33 = 1.5;

type GeminiParams = { style: string; pace: string; accent: string };

type Props = {
  lang: LangCode;
  provider: Provider;
  audioState?: AudioState;
  onGenerate: (lang: LangCode, voice: string, speed: number, modelId?: string, geminiParams?: GeminiParams) => void;
  audioEnabled?: boolean;
};

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

type AudioPlayerProps = {
  audioUrl: string;
  filename?: string;
  showSilenceRemoval?: boolean;
  onReplace?: (url: string, filename: string) => void;
};

function AudioPlayer({ audioUrl, filename, showSilenceRemoval, onReplace }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      el.play().catch(() => {});
      setPlaying(true);
    }
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const el = audioRef.current;
    const bar = barRef.current;
    if (!el || !bar || !el.duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * el.duration;
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="mt-3 flex flex-wrap sm:flex-nowrap items-center gap-x-2 gap-y-1 sm:gap-3 p-2 pr-2 sm:pr-3 rounded-2xl bg-ink/60 border border-line-soft">
      <audio
        ref={audioRef}
        src={audioUrl}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onEnded={() => { setPlaying(false); setCurrentTime(0); }}
      />

      <button
        onClick={toggle}
        className="shrink-0 w-10 h-10 rounded-xl grid place-items-center bg-accent-deep text-white hover:bg-accent transition-colors"
        aria-label={playing ? "Pause" : "Lecture"}
      >
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="translate-x-px" />}
      </button>

      <div
        onClick={seek}
        className="order-last basis-full px-1 sm:px-0 sm:order-none sm:basis-auto sm:flex-1 min-w-0 relative h-6 cursor-pointer group flex items-center"
        title="Cliquer pour avancer"
      >
        <div ref={barRef} className="relative w-full h-1.5">
          <div className="absolute inset-0 rounded-full bg-line" />
          <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${progress}%` }} />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-fg shadow-[0_0_0_3px_var(--color-accent)] opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ left: `calc(${progress}% - 7px)` }}
          />
        </div>
      </div>

      <span className="shrink-0 mr-auto sm:mr-0 text-[13px] text-muted tabular-nums text-center min-w-[78px]">
        {fmt(currentTime)} / {fmt(duration)}
      </span>

      {filename && (
        <a
          href={audioUrl}
          download={filename}
          className="shrink-0 w-10 h-10 rounded-xl grid place-items-center text-muted hover:text-fg hover:bg-raised transition-colors"
          title="Télécharger l'audio"
        >
          <Download size={17} />
        </a>
      )}

      {showSilenceRemoval && onReplace && (
        <SilenceRemoveControls audioUrl={audioUrl} filename={filename} onReplace={onReplace} />
      )}
    </div>
  );
}

const selectClass =
  "dav-select w-full h-10 pl-3.5 rounded-xl bg-raised border border-transparent text-[14px] text-fg focus:outline-none focus:border-accent/60 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";

export function LanguageRow({ lang, provider, audioState, onGenerate, audioEnabled }: Props) {
  const audioDisabled = !audioEnabled;
  const { config, update } = useVoiceConfig(provider, lang);

  const [modelId, setModelId] = useState(EL_MODEL_DEFAULT);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`el_model_${lang}`);
      if (saved) setModelId(saved);
    } catch {}
  }, [lang]);

  function handleModelChange(id: string) {
    setModelId(id);
    try { localStorage.setItem(`el_model_${lang}`, id); } catch {}
  }

  const isEdge = provider === "edge-tts";
  const isGoogle = provider === "google-tts";
  const isAi33 = provider === "ai33-minimax" || provider === "ai33-elevenlabs";
  const isDirect = provider === "elevenlabs";
  const isGemini = provider === "google-ai-studio";

  const voices: { id: string; label: string }[] = (() => {
    if (isEdge) return [...EDGE_TTS_VOICES[EDGE_LANG_MAP[lang]]];
    if (isGoogle) return [...GOOGLE_TTS_VOICES[GOOGLE_LANG_MAP[lang]].voices];
    if (isAi33) return AI33_VOICES;
    if (isDirect) return ELEVENLABS_DIRECT_VOICES;
    if (isGemini) return GEMINI_TTS_VOICES;
    return [];
  })();

  // Une seule voix proposée : on s'assure que c'est bien elle qui part à la génération.
  const singleVoice = voices.length === 1 ? voices[0] : null;
  useEffect(() => {
    if (singleVoice && config.voice !== singleVoice.id) update({ voice: singleVoice.id });
  }, [singleVoice, config.voice, update]);

  const showModelSelect = config.voice.startsWith("elevenlabs_") || isDirect;
  const speedMin = isGemini ? GEMINI_SPEED_MIN : showModelSelect ? (isDirect ? EL_SPEED_MIN_DIRECT : EL_SPEED_MIN_AI33) : SPEED_MIN;
  const speedMax = isGemini ? GEMINI_SPEED_MAX : showModelSelect ? (isDirect ? EL_SPEED_MAX_DIRECT : EL_SPEED_MAX_AI33) : SPEED_MAX;

  const isLoading = audioState?.status === "loading";
  const isDone = audioState?.status === "done";
  const isError = audioState?.status === "error";

  const currentAudioUrl = audioState?.audioUrl;

  // L'audio sans silences remplace l'original jusqu'à la prochaine génération.
  const [processedAudio, setProcessedAudio] = useState<{ url: string; filename: string } | null>(null);
  useEffect(() => { setProcessedAudio(null); }, [currentAudioUrl]);
  const displayAudioUrl = processedAudio?.url ?? currentAudioUrl;
  const displayFilename = processedAudio?.filename ?? audioState?.filename;

  function handleGenerate() {
    const geminiParams: GeminiParams | undefined = isGemini
      ? {
          style: config.style ?? GEMINI_STYLE_DEFAULT,
          pace: config.pace ?? GEMINI_PACE_DEFAULT,
          accent: config.accent ?? GEMINI_ACCENT_DEFAULT,
        }
      : undefined;
    onGenerate(lang, singleVoice ? singleVoice.id : config.voice, config.speed, showModelSelect ? modelId : undefined, geminiParams);
  }

  return (
    <div className="px-3 sm:px-4 py-3.5 rounded-2xl hover:bg-raised/30 transition-colors">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        {/* Langue + voix + modèle */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span
            className="shrink-0 w-11 h-11 rounded-[14px] grid place-items-center bg-raised font-display text-[18px] font-semibold text-fg"
            title={LANG_NAMES[lang]}
          >
            {lang}
          </span>

          <div className={`min-w-0 flex-1 grid gap-2 ${showModelSelect ? "sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" : ""}`}>
            {singleVoice ? (
              <div className="h-10 px-3.5 rounded-xl bg-raised/60 flex items-center min-w-0">
                <span className="text-[14px] text-fg truncate">{singleVoice.label}</span>
              </div>
            ) : (
              <select
                value={config.voice}
                onChange={(e) => update({ voice: e.target.value })}
                className={selectClass}
                aria-label={`Voix ${LANG_NAMES[lang]}`}
              >
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
              </select>
            )}

            {showModelSelect && (
              <select
                value={modelId}
                onChange={(e) => handleModelChange(e.target.value)}
                className={selectClass}
                aria-label={`Modèle ${LANG_NAMES[lang]}`}
              >
                {(isDirect ? EL_MODELS_DIRECT : EL_MODELS).map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Vitesse + action */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2.5 shrink-0" title="Vitesse de la voix">
            <input
              type="range"
              min={isEdge ? EDGE_RATE_MIN : speedMin}
              max={isEdge ? EDGE_RATE_MAX : speedMax}
              step={isEdge ? 5 : 0.05}
              value={config.speed}
              onChange={(e) => update({ speed: parseFloat(e.target.value) })}
              className="w-20 sm:w-24"
              aria-label={`Vitesse ${LANG_NAMES[lang]}`}
            />
            <span className="w-12 text-[14px] font-medium text-muted tabular-nums text-right">
              {isEdge ? `${config.speed >= 0 ? "+" : ""}${config.speed}%` : `${config.speed.toFixed(2)}×`}
            </span>
          </label>

          <button
            onClick={handleGenerate}
            disabled={isLoading || audioDisabled}
            title={audioDisabled ? "Réservé au profil directeur" : undefined}
            className={`flex-1 min-w-0 lg:flex-none lg:w-[150px] h-10 rounded-xl inline-flex items-center justify-center gap-2 text-[14px] font-semibold transition-colors disabled:cursor-not-allowed ${
              audioDisabled
                ? "bg-raised/60 text-dim"
                : isError
                ? "bg-bad/15 text-bad hover:bg-bad/25"
                : isDone
                ? "bg-raised text-muted hover:text-fg hover:bg-hover"
                : isLoading
                ? "bg-raised text-muted"
                : "bg-accent/15 text-accent-hi hover:bg-accent/25"
            }`}
          >
            {isLoading ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                <span className="truncate max-w-[96px]">{audioState?.label ?? "En cours"}</span>
              </>
            ) : isError && !audioDisabled ? (
              <>
                <RotateCcw size={15} />
                Réessayer
              </>
            ) : isDone ? (
              <>
                <RefreshCw size={15} />
                Régénérer
              </>
            ) : (
              <>
                <Play size={15} />
                Générer
              </>
            )}
          </button>
        </div>
      </div>

      {/* Réglages Google AI Studio */}
      {isGemini && (
        <div className="mt-3 grid grid-cols-3 gap-2 lg:pl-14">
          <select value={config.style ?? GEMINI_STYLE_DEFAULT} onChange={(e) => update({ style: e.target.value })} className={selectClass} aria-label="Style">
            {GEMINI_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={config.pace ?? GEMINI_PACE_DEFAULT} onChange={(e) => update({ pace: e.target.value })} className={selectClass} aria-label="Rythme">
            {GEMINI_PACES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={config.accent ?? GEMINI_ACCENT_DEFAULT} onChange={(e) => update({ accent: e.target.value })} className={selectClass} aria-label="Accent">
            {GEMINI_ACCENTS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      )}

      {/* Message d'erreur lisible */}
      {isError && audioState?.label && (
        <p className="mt-2.5 lg:pl-14 text-[14px] text-bad">{audioState.label}</p>
      )}

      {/* Lecteur */}
      {isDone && displayAudioUrl && (
        <div className="lg:pl-14">
          <AudioPlayer
            key={displayAudioUrl}
            audioUrl={displayAudioUrl}
            filename={displayFilename}
            showSilenceRemoval={audioEnabled}
            onReplace={(url, fname) => setProcessedAudio({ url, filename: fname })}
          />
          <p className="mt-1.5 px-1 flex items-center gap-1.5 text-[12px] text-dim truncate">
            <Check size={13} className="text-ok shrink-0" />
            <span className="truncate">{displayFilename}</span>
          </p>
        </div>
      )}
    </div>
  );
}
