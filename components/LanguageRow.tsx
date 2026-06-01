"use client";

import { Play, RefreshCw, Loader2, Pause, X, Scissors, CheckCircle2, AlertCircle } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import { useVoiceConfig } from "../hooks/useVoiceConfig";
import type { Provider, AudioState } from "../types";
import { EDGE_TTS_VOICES } from "../lib/edge-tts-voices";
import { GOOGLE_TTS_VOICES } from "../lib/google-tts-voices";

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

type SilenceStatus = "idle" | "loading" | "done" | "error";

type Props = {
  lang: LangCode;
  provider: Provider;
  audioState?: AudioState;
  onGenerate: (lang: LangCode, voice: string, speed: number) => void;
};

function StatusDot({ state }: { state?: AudioState }) {
  if (!state) return <span className="w-2 h-2 rounded-full border border-[#2a2a3e] inline-block" title="idle" />;
  if (state.status === "loading") return <Loader2 size={12} className="text-[#a0a0b8] animate-spin" />;
  if (state.status === "done") return <span className="w-2 h-2 rounded-full bg-[#00ffaa] inline-block" title="ready" />;
  return <span className="w-2 h-2 rounded-full bg-[#ff4466] inline-block" title="error" />;
}

function MiniAudioPlayer({ audioUrl, filename }: { audioUrl: string; filename?: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); }
    else { el.play(); setPlaying(true); }
  }

  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <audio
        ref={audioRef}
        src={audioUrl}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          if (el.duration) setProgress((el.currentTime / el.duration) * 100);
        }}
        onEnded={() => { setPlaying(false); setProgress(0); }}
      />
      <button
        onClick={toggle}
        className="shrink-0 w-6 h-6 flex items-center justify-center border border-[#2a2a3e] text-[#555577] hover:border-[#00e5ff] hover:text-[#00e5ff] transition-none"
        style={{ borderRadius: "2px" }}
      >
        {playing ? <Pause size={10} /> : <Play size={10} />}
      </button>
      <div className="flex-1 h-0.5 bg-[#1e1e2e] relative overflow-hidden" style={{ borderRadius: "1px" }}>
        <div className="h-full bg-[#00e5ff] transition-none" style={{ width: `${progress}%` }} />
      </div>
      {filename && (
        <a
          href={audioUrl}
          download={filename}
          className="text-[10px] text-[#555577] hover:text-[#00e5ff] font-mono transition-none shrink-0"
          title="Télécharger"
        >
          ↓
        </a>
      )}
    </div>
  );
}

export function LanguageRow({ lang, provider, audioState, onGenerate }: Props) {
  const { config, update } = useVoiceConfig(provider, lang);

  const [silenceStatus, setSilenceStatus] = useState<SilenceStatus>("idle");
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [processedDuration, setProcessedDuration] = useState<string | null>(null);

  // Reset silence state whenever a new audio is generated
  useEffect(() => {
    setSilenceStatus("idle");
    setProcessedUrl(null);
    setProcessedDuration(null);
  }, [audioState?.audioUrl]);

  const isEdge = provider === "edge-tts";
  const isGoogle = provider === "google-tts";

  const voices: { id: string; label: string }[] = (() => {
    if (isEdge) return [...EDGE_TTS_VOICES[EDGE_LANG_MAP[lang]]];
    if (isGoogle) return [...GOOGLE_TTS_VOICES[GOOGLE_LANG_MAP[lang]].voices];
    return [];
  })();

  const hasVoiceSelect = voices.length > 0;
  const isLoading = audioState?.status === "loading";
  const isDone = audioState?.status === "done";
  const isError = audioState?.status === "error";

  // Show the processed audio after silence removal, otherwise the original
  const currentAudioUrl = processedUrl ?? audioState?.audioUrl;

  function handleGenerate() {
    onGenerate(lang, config.voice, config.speed);
  }

  async function handleRemoveSilence() {
    if (!audioState?.audioUrl) return;
    setSilenceStatus("loading");
    try {
      // Fetch the local blob URL to get the binary data
      const blobRes = await fetch(audioState.audioUrl);
      const blob = await blobRes.blob();

      const form = new FormData();
      form.append("audio", blob, audioState.filename ?? "audio.mp3");

      const res = await fetch("/api/tts/remove-silence", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        setSilenceStatus("error");
        return;
      }

      const duration = res.headers.get("X-Duration");
      const processedBlob = await res.blob();
      const url = URL.createObjectURL(processedBlob);

      setProcessedUrl(url);
      setProcessedDuration(duration || null);
      setSilenceStatus("done");
    } catch {
      setSilenceStatus("error");
    }
  }

  return (
    <div className="flex flex-col py-1.5">
      {/* Main row */}
      <div className="flex items-center gap-2">
        {/* Lang badge */}
        <span className="text-[11px] font-mono font-semibold text-[#a0a0b8] w-6 shrink-0 uppercase tracking-wider">
          {lang}
        </span>

        {/* Voice select */}
        {hasVoiceSelect ? (
          <select
            value={config.voice}
            onChange={(e) => update({ voice: e.target.value })}
            className="flex-1 min-w-0 bg-[#0d0d15] border border-[#1e1e2e] text-[11px] font-mono text-[#e0e0f0] px-2 py-1 focus:outline-none focus:border-[#00e5ff] cursor-pointer"
            style={{ borderRadius: "2px" }}
          >
            {voices.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        ) : (
          <span
            className="flex-1 min-w-0 text-[11px] font-mono text-[#555577] px-2 py-1 border border-[#1e1e2e] truncate"
            style={{ borderRadius: "2px" }}
          >
            {provider === "ai33-minimax" ? "Minimax Speech-2.6" : "ElevenLabs Multilingual v2"}
          </span>
        )}

        {/* Speed slider */}
        <div className="flex items-center gap-1.5 w-28 shrink-0">
          <input
            type="range"
            min={isEdge ? EDGE_RATE_MIN : SPEED_MIN}
            max={isEdge ? EDGE_RATE_MAX : SPEED_MAX}
            step={isEdge ? 5 : 0.05}
            value={config.speed}
            onChange={(e) => update({ speed: parseFloat(e.target.value) })}
            className="flex-1 h-0.5 bg-[#1e1e2e] cursor-pointer"
            style={{ accentColor: "#00e5ff" }}
          />
          <span className="text-[10px] font-mono text-[#555577] w-9 text-right shrink-0">
            {isEdge
              ? `${config.speed >= 0 ? "+" : ""}${config.speed}%`
              : `×${config.speed.toFixed(2)}`}
          </span>
        </div>

        {/* Generate button or audio player */}
        {isDone && currentAudioUrl ? (
          <div className="flex items-center gap-2 w-36 shrink-0">
            <MiniAudioPlayer
              key={currentAudioUrl}
              audioUrl={currentAudioUrl}
              filename={audioState?.filename}
            />
            <button
              onClick={handleGenerate}
              className="shrink-0 px-2 py-1 text-[10px] font-mono text-[#555577] hover:text-[#00e5ff] border border-[#1e1e2e] hover:border-[#00e5ff] transition-none"
              style={{ borderRadius: "2px" }}
              title="Régénérer"
            >
              <RefreshCw size={10} />
            </button>
          </div>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={isLoading}
            className={`shrink-0 w-36 px-3 py-1 text-[11px] font-mono font-semibold border transition-none flex items-center justify-center gap-1.5 disabled:opacity-50 ${
              isError
                ? "bg-transparent border-[#ff4466] text-[#ff4466] hover:bg-[#ff4466] hover:text-black"
                : "bg-transparent border-[#1e1e2e] text-[#e0e0f0] hover:border-[#00e5ff] hover:text-[#00e5ff]"
            }`}
            style={{ borderRadius: "2px" }}
          >
            {isLoading ? (
              <>
                <Loader2 size={10} className="animate-spin" />
                <span className="truncate max-w-[80px]">{audioState?.label ?? "..."}</span>
              </>
            ) : isError ? (
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

      {/* Remove silence button — shown when audio is ready */}
      {isDone && audioState?.audioUrl && (
        <div className="pt-1.5">
          <button
            onClick={silenceStatus === "loading" ? undefined : handleRemoveSilence}
            disabled={silenceStatus === "loading"}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-[11px] font-mono border transition-none disabled:opacity-60"
            style={{
              borderRadius: "2px",
              fontFamily: "var(--font-space-mono, monospace)",
              background: "#0a0a10",
              borderColor:
                silenceStatus === "done"
                  ? "#00ffaa"
                  : silenceStatus === "error"
                  ? "#ff4466"
                  : "#00e5ff",
              color:
                silenceStatus === "done"
                  ? "#00ffaa"
                  : silenceStatus === "error"
                  ? "#ff4466"
                  : "#00e5ff",
            }}
          >
            {silenceStatus === "loading" && (
              <>
                <Loader2 size={11} className="animate-spin shrink-0" />
                <span>Traitement en cours...</span>
              </>
            )}
            {silenceStatus === "done" && (
              <>
                <CheckCircle2 size={11} className="shrink-0" />
                <span>
                  Silences supprimés ✓
                  {processedDuration && (
                    <span className="ml-2 opacity-70">{processedDuration}</span>
                  )}
                </span>
              </>
            )}
            {silenceStatus === "error" && (
              <>
                <AlertCircle size={11} className="shrink-0" />
                <span>Erreur — réessayer</span>
              </>
            )}
            {silenceStatus === "idle" && (
              <>
                <Scissors size={11} className="shrink-0" />
                <span>Supprimer les silences</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
