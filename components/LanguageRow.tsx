"use client";

import { Play, RefreshCw, Loader2, Pause, X, Download } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import { useVoiceConfig } from "../hooks/useVoiceConfig";
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

const EDGE_LANG_MAP: Record<LangCode, keyof typeof EDGE_TTS_VOICES> = {
  FR: "fr", EN: "en", DE: "de", ES: "es",
};
const GOOGLE_LANG_MAP: Record<LangCode, keyof typeof GOOGLE_TTS_VOICES> = {
  FR: "fr", EN: "en", DE: "de", ES: "es",
};

const EDGE_RATE_MIN = -50;
const EDGE_RATE_MAX = 200;
const SPEED_MIN = 0.5;
const SPEED_MAX = 2.0;
const GEMINI_SPEED_MIN = 0.5;
const GEMINI_SPEED_MAX = 1.5;

const AI33_VOICES: { id: string; label: string }[] = [
  { id: "elevenlabs_6DsgX00trsI64jl83WWS", label: "Alex Upbeat (ElevenLabs) ⭐" },
  { id: "clone_2608233",                   label: "ALEX CLONED" },
  { id: "clone_2580971",                   label: "Foot French" },
  { id: "clone_2607201",                   label: "NARATEUR ANIME" },
  { id: "clone_2606818",                   label: "Arnold sama" },
  { id: "elevenlabs_CwhRBWXzGAHq8TQ4Fs17", label: "Brian (ElevenLabs)" },
  { id: "elevenlabs_JBFqnCBsd6RMkjVDRZzb", label: "George — Storyteller (ElevenLabs)" },
  { id: "kokoro_am_liam",                  label: "Liam — American EN ♂" },
  { id: "kokoro_am_puck",                  label: "Puck — American EN ♂" },
  { id: "kokoro_af_heart",                 label: "Heart — American EN ♀ ★" },
  { id: "kokoro_bm_george",                label: "George — British (Kokoro)" },
];

const ELEVENLABS_DIRECT_VOICES: { id: string; label: string }[] = [
  { id: "6DsgX00trsI64jl83WWS", label: "Alex Upbeat ⭐" },
  { id: "CwhRBWXzGAHq8TQ4Fs17", label: "Brian" },
  { id: "JBFqnCBsd6RMkjVDRZzb", label: "George - Storyteller" },
  { id: "21m00Tcm4TlvDq8ikWAM", label: "Rachel" },
  { id: "TxGEqnHWrfWFTfGW9XjX", label: "Josh" },
];

const EL_MODELS: { id: string; label: string }[] = [
  { id: "eleven_multilingual_v2", label: "Multilingual v2" },
  { id: "eleven_v3",              label: "Eleven v3 (default)" },
  { id: "eleven_flash_v2_5",      label: "Flash v2.5" },
];

const EL_MODEL_DEFAULT = "eleven_v3";

// Real API-enforced speed ranges: ElevenLabs' own voice_settings.speed only
// accepts 0.7–1.2; AI33 applies its own post-processing on top and accepts 0.5–1.5.
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

function StatusDot({ state }: { state?: AudioState }) {
  if (!state) return <span className="w-2 h-2 rounded-full border border-[#223a2f] inline-block" title="idle" />;
  if (state.status === "loading") return <Loader2 size={12} className="text-[#8aaa98] animate-spin" />;
  if (state.status === "done") return <span className="w-2 h-2 rounded-full bg-[#00ff88] inline-block" title="ready" />;
  return <span className="w-2 h-2 rounded-full bg-[#ff4466] inline-block" title="error" />;
}

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function AudioPlayer({ audioUrl, filename }: { audioUrl: string; filename?: string }) {
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
    <div
      className="w-full flex items-center gap-4 px-4 py-2.5 border border-[#1a2e25]"
      style={{ background: "#0d1512", borderRadius: "2px" }}
    >
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
        className="shrink-0 w-9 h-9 flex items-center justify-center border border-[#223a2f] text-[#8aaa98] hover:border-[#00e5a0] hover:text-[#00e5a0] transition-none"
        style={{ borderRadius: "2px" }}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>

      <div
        ref={barRef}
        onClick={seek}
        className="flex-1 min-w-0 relative h-2 cursor-pointer group"
        style={{ borderRadius: "2px" }}
        title="Cliquer pour naviguer"
      >
        <div className="absolute inset-0 bg-[#1a2e25]" style={{ borderRadius: "2px" }} />
        <div
          className="absolute inset-y-0 left-0 bg-[#00e5a0]"
          style={{ width: `${progress}%`, borderRadius: "2px" }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-[#00e5a0] opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `calc(${progress}% - 5px)`, borderRadius: "50%" }}
        />
      </div>

      <span
        className="shrink-0 text-[11px] text-[#8aaa98] tabular-nums"
        style={{ fontFamily: "var(--font-space-mono, monospace)", minWidth: "84px", textAlign: "center" }}
      >
        {fmt(currentTime)} / {fmt(duration)}
      </span>

      {filename && (
        <a
          href={audioUrl}
          download={filename}
          className="shrink-0 w-9 h-9 flex items-center justify-center border border-[#1a2e25] text-[#4a6a58] hover:border-[#00e5a0] hover:text-[#00e5a0] transition-none"
          style={{ borderRadius: "2px" }}
          title="Télécharger"
        >
          <Download size={14} />
        </a>
      )}
    </div>
  );
}

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

  const hasVoiceSelect = voices.length > 0;
  const showModelSelect = config.voice.startsWith("elevenlabs_") || isDirect;
  const speedMin = isGemini ? GEMINI_SPEED_MIN : showModelSelect ? (isDirect ? EL_SPEED_MIN_DIRECT : EL_SPEED_MIN_AI33) : SPEED_MIN;
  const speedMax = isGemini ? GEMINI_SPEED_MAX : showModelSelect ? (isDirect ? EL_SPEED_MAX_DIRECT : EL_SPEED_MAX_AI33) : SPEED_MAX;

  const isLoading = audioState?.status === "loading";
  const isDone = audioState?.status === "done";
  const isError = audioState?.status === "error";

  const currentAudioUrl = audioState?.audioUrl;

  function handleGenerate() {
    const geminiParams: GeminiParams | undefined = isGemini
      ? {
          style: config.style ?? GEMINI_STYLE_DEFAULT,
          pace: config.pace ?? GEMINI_PACE_DEFAULT,
          accent: config.accent ?? GEMINI_ACCENT_DEFAULT,
        }
      : undefined;
    onGenerate(lang, config.voice, config.speed, showModelSelect ? modelId : undefined, geminiParams);
  }

  return (
    <div className="flex flex-col py-2 gap-1.5">

      {/* ── Controls row ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">

        {/* Lang badge */}
        <span className="text-[11px] font-mono font-semibold text-[#8aaa98] w-6 shrink-0 uppercase tracking-wider">
          {lang}
        </span>

        {/* Voice select */}
        {hasVoiceSelect ? (
          <select
            value={config.voice}
            onChange={(e) => update({ voice: e.target.value })}
            className="flex-1 min-w-0 bg-[#0a1210] border border-[#1a2e25] text-[11px] font-mono text-[#e0f0e8] px-2 py-1 focus:outline-none focus:border-[#00e5a0] cursor-pointer"
            style={{ borderRadius: "2px" }}
          >
            {voices.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        ) : (
          <span
            className="flex-1 min-w-0 text-[11px] font-mono text-[#4a6a58] px-2 py-1 border border-[#1a2e25] truncate"
            style={{ borderRadius: "2px" }}
          >
            ElevenLabs Direct
          </span>
        )}

        {/* Speed slider */}
        <div className="flex items-center gap-1.5 w-28 shrink-0">
          <input
            type="range"
            min={isEdge ? EDGE_RATE_MIN : speedMin}
            max={isEdge ? EDGE_RATE_MAX : speedMax}
            step={isEdge ? 5 : 0.05}
            value={config.speed}
            onChange={(e) => update({ speed: parseFloat(e.target.value) })}
            className="flex-1 h-0.5 bg-[#1a2e25] cursor-pointer"
            style={{ accentColor: "#00e5a0" }}
          />
          <span className="text-[10px] font-mono text-[#4a6a58] w-9 text-right shrink-0">
            {isEdge
              ? `${config.speed >= 0 ? "+" : ""}${config.speed}%`
              : `×${config.speed.toFixed(2)}`}
          </span>
        </div>

        {/* Generate / Régénérer */}
        {isDone ? (
          <button
            onClick={handleGenerate}
            disabled={audioDisabled}
            title={audioDisabled ? "Audio generation is disabled" : undefined}
            className={`shrink-0 w-36 px-3 py-1 text-[11px] font-mono border transition-none flex items-center justify-center gap-1.5 ${
              audioDisabled
                ? "cursor-not-allowed bg-transparent border-[#1a2e25] text-[#4a6a58] opacity-50"
                : "border-[#1a2e25] text-[#4a6a58] hover:border-[#00e5a0] hover:text-[#00e5a0]"
            }`}
            style={{ borderRadius: "2px" }}
          >
            <RefreshCw size={10} />
            Régénérer
          </button>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={isLoading || audioDisabled}
            title={audioDisabled ? "Audio generation is disabled" : undefined}
            className={`shrink-0 w-36 px-3 py-1 text-[11px] font-mono font-semibold border transition-none flex items-center justify-center gap-1.5 disabled:opacity-50 ${
              audioDisabled
                ? "cursor-not-allowed bg-transparent border-[#1a2e25] text-[#4a6a58]"
                : isError
                ? "bg-transparent border-[#ff4466] text-[#ff4466] hover:bg-[#ff4466] hover:text-black"
                : "bg-transparent border-[#1a2e25] text-[#e0f0e8] hover:border-[#00e5a0] hover:text-[#00e5a0]"
            }`}
            style={{ borderRadius: "2px" }}
          >
            {isLoading ? (
              <>
                <Loader2 size={10} className="animate-spin" />
                <span className="truncate max-w-[80px]">{audioState?.label ?? "..."}</span>
              </>
            ) : isError && !audioDisabled ? (
              <>
                <X size={10} />
                Réessayer
              </>
            ) : (
              <>
                <Play size={10} />
                Générer
              </>
            )}
          </button>
        )}

        {/* Status dot */}
        <div className="shrink-0 w-4 flex items-center justify-center">
          <StatusDot state={audioState} />
        </div>
      </div>

      {/* ── Model dropdown (ElevenLabs voices only) ──────────────────────── */}
      {showModelSelect && (
        <div className="flex items-center gap-2 ml-8">
          <select
            value={modelId}
            onChange={(e) => handleModelChange(e.target.value)}
            className="w-full bg-[#0a1210] border border-[#1a2e25] text-[10px] font-mono text-[#8aaa98] px-2 py-1 focus:outline-none focus:border-[#00e5a0] cursor-pointer"
            style={{ borderRadius: "2px" }}
            title="ElevenLabs model"
          >
            {EL_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* ── Style / Pace / Accent (Google AI Studio only) ─────────────────── */}
      {isGemini && (
        <div className="flex items-center gap-2 ml-8">
          <select
            value={config.style ?? GEMINI_STYLE_DEFAULT}
            onChange={(e) => update({ style: e.target.value })}
            className="flex-1 bg-[#0a1210] border border-[#1a2e25] text-[10px] font-mono text-[#8aaa98] px-2 py-1 focus:outline-none focus:border-[#00e5a0] cursor-pointer"
            style={{ borderRadius: "2px" }}
            title="Style"
          >
            {GEMINI_STYLES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={config.pace ?? GEMINI_PACE_DEFAULT}
            onChange={(e) => update({ pace: e.target.value })}
            className="flex-1 bg-[#0a1210] border border-[#1a2e25] text-[10px] font-mono text-[#8aaa98] px-2 py-1 focus:outline-none focus:border-[#00e5a0] cursor-pointer"
            style={{ borderRadius: "2px" }}
            title="Pace"
          >
            {GEMINI_PACES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select
            value={config.accent ?? GEMINI_ACCENT_DEFAULT}
            onChange={(e) => update({ accent: e.target.value })}
            className="flex-1 bg-[#0a1210] border border-[#1a2e25] text-[10px] font-mono text-[#8aaa98] px-2 py-1 focus:outline-none focus:border-[#00e5a0] cursor-pointer"
            style={{ borderRadius: "2px" }}
            title="Accent"
          >
            {GEMINI_ACCENTS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      )}

      {/* ── Audio player ─────────────────────────────────────────────────── */}
      {isDone && currentAudioUrl && (
        <AudioPlayer
          key={currentAudioUrl}
          audioUrl={currentAudioUrl}
          filename={audioState?.filename}
        />
      )}
    </div>
  );
}



