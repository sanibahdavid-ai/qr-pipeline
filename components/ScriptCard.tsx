"use client";

import { useState, useRef } from "react";
import { Play, Pause, Download } from "lucide-react";
import type { Section, AudioState } from "../types";

type AdjustDuration = "10s" | "15s" | "30s" | "45s" | "1min30" | "2min";

function AudioPlayer({ audioUrl, filename }: { audioUrl: string; filename?: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); }
    else { el.play(); setPlaying(true); }
  }

  function formatTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const el = audioRef.current;
    if (!el || !el.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    el.currentTime = ((e.clientX - rect.left) / rect.width) * el.duration;
  }

  return (
    <div className="flex items-center gap-2">
      <audio
        ref={audioRef}
        src={audioUrl}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          if (el.duration) {
            setProgress((el.currentTime / el.duration) * 100);
            setCurrentTime(el.currentTime);
          }
        }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={() => { setPlaying(false); setProgress(0); setCurrentTime(0); }}
      />
      <button
        onClick={toggle}
        className="shrink-0 w-6 h-6 flex items-center justify-center border border-[#2a4a75] hover:border-[#00b4ff] hover:text-[#00b4ff] transition-none text-[#4a6a8a]"
        style={{ borderRadius: "2px" }}
      >
        {playing ? <Pause size={10} /> : <Play size={10} />}
      </button>
      <div
        className="flex-1 h-0.5 bg-[#1a2942] relative overflow-hidden cursor-pointer"
        style={{ borderRadius: "1px" }}
        onClick={handleSeek}
      >
        <div className="h-full bg-[#00b4ff]" style={{ width: `${progress}%` }} />
      </div>
      <span className="text-[10px] font-mono text-[#4a6a8a] shrink-0 tabular-nums">
        {formatTime(currentTime)}{duration ? `/${formatTime(duration)}` : ""}
      </span>
      {filename && (
        <a
          href={audioUrl}
          download={filename}
          className="shrink-0 text-[#4a6a8a] hover:text-[#00b4ff] transition-none"
          title="Télécharger"
        >
          <Download size={11} />
        </a>
      )}
    </div>
  );
}

type Props = {
  section: Section;
  content: string;
  stats: { words: number; duration: string } | null;
  adjustDurations: readonly AdjustDuration[];
  isAdjusting: boolean;
  hasOverride: boolean;
  adjusting: boolean;
  audioState?: AudioState;
  isCopied: boolean;
  isAutoCorrection?: boolean;
  onCopy: () => void;
  onAdjust: (dur: AdjustDuration) => void;
  onAdjustCustom?: (seconds: number) => void;
  onRestore: () => void;
  healthScore?: number;
  healthFeedback?: string | null;
};

export function ScriptCard({
  section, content, stats, adjustDurations, isAdjusting, hasOverride,
  adjusting, audioState, isCopied, isAutoCorrection, onCopy, onAdjust,
  onAdjustCustom, onRestore, healthScore, healthFeedback,
}: Props) {
  const [customSec, setCustomSec] = useState("");

  function submitCustom() {
    const sec = parseFloat(customSec);
    if (!isNaN(sec) && sec > 0 && onAdjustCustom) onAdjustCustom(sec);
  }

  return (
    <div className="bg-[#0d1420] border border-[#1a2942] overflow-hidden flex flex-col" style={{ borderRadius: "4px" }}>
      {/* Gradient top bar */}
      <div className="h-[2px] w-full shrink-0" style={{ background: "linear-gradient(90deg, #00b4ff, #ff3cac)" }} />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a2942]">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-[10px] font-mono font-semibold text-[#7a9ac2] tracking-widest uppercase shrink-0">
            {section}
          </span>
          {stats && (
            <span className="text-[10px] font-mono text-[#4a6a8a] shrink-0">
              {stats.words}w · {stats.duration}
            </span>
          )}
          {isAdjusting && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-[#4a6a8a] shrink-0">
              <span className="w-2 h-2 rounded-full bg-[#F59E0B] animate-pulse" />
              Réécriture…
            </span>
          )}
          {isAutoCorrection && !isAdjusting && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-[#00b4ff] shrink-0">
              <span className="w-2 h-2 rounded-full bg-[#00b4ff] animate-pulse" />
              Correction…
            </span>
          )}
          {hasOverride && !isAdjusting && (
            <button
              onClick={onRestore}
              className="text-[10px] font-mono text-[#4a6a8a] hover:text-[#e0eef8] transition-none shrink-0"
            >
              ↩ Original
            </button>
          )}
        </div>
        <button
          onClick={onCopy}
          className="text-[10px] font-mono text-[#4a6a8a] hover:text-[#00b4ff] transition-none shrink-0 ml-2"
        >
          {isCopied ? "Copié ✓" : "Copier"}
        </button>
      </div>

      {/* Body */}
      <div className="px-3 py-3 flex-1">
        <p className="text-[13px] font-mono text-[#e0eef8] whitespace-pre-wrap leading-[1.7]">
          {content}
        </p>
      </div>

      {/* Audio player */}
      {audioState?.status === "done" && audioState.audioUrl && (
        <div className="px-3 py-2.5 border-t border-[#1a2942]">
          <AudioPlayer audioUrl={audioState.audioUrl} filename={audioState.filename} />
        </div>
      )}

      {/* Health score bar */}
      {healthScore !== undefined && (
        <div className="px-3 py-2 border-t border-[#1a2942]">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 bg-[#1a2942] overflow-hidden" style={{ borderRadius: "1px" }}>
              <div
                className="h-full transition-all duration-500"
                style={{
                  width: `${healthScore}%`,
                  background: healthScore >= 80 ? "#00b4ff" : healthScore >= 60 ? "#f59e0b" : "#ff4466",
                }}
              />
            </div>
            <span
              className="text-[10px] font-mono shrink-0 tabular-nums"
              style={{ color: healthScore >= 80 ? "#00b4ff" : healthScore >= 60 ? "#f59e0b" : "#ff4466" }}
            >
              {healthScore}
            </span>
          </div>
          {healthFeedback && (
            <p className="text-[10px] font-mono text-[#f59e0b] mt-1 leading-snug">{healthFeedback}</p>
          )}
        </div>
      )}

      {/* Adjust durations + custom seconds */}
      <div className="px-3 py-2 border-t border-[#1a2942] flex flex-wrap gap-1 items-center">
        {adjustDurations.map((d) => (
          <button
            key={d}
            onClick={() => { onAdjust(d); setCustomSec(""); }}
            disabled={adjusting}
            className="text-[10px] font-mono px-2 py-0.5 border border-[#1a2942] text-[#4a6a8a] hover:border-[#00b4ff] hover:text-[#00b4ff] disabled:opacity-40 transition-none"
            style={{ borderRadius: "2px" }}
          >
            {d}
          </button>
        ))}
        {onAdjustCustom && (
          <input
            type="number"
            min={1}
            max={600}
            placeholder="sec"
            value={customSec}
            onChange={(e) => setCustomSec(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitCustom(); }}
            onBlur={submitCustom}
            disabled={adjusting}
            className="text-[10px] font-mono px-1.5 py-0.5 bg-[#0a1420] border border-[#1a2942] text-[#7a9ac2] focus:outline-none focus:border-[#00b4ff] disabled:opacity-40 transition-none"
            style={{ borderRadius: "2px", width: "52px" }}
          />
        )}
      </div>
    </div>
  );
}
