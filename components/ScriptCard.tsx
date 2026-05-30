"use client";

import { useState, useRef } from "react";
import { Play, Pause, Download } from "lucide-react";
import type { Section, AudioState } from "../types";

type AdjustDuration = "10s" | "15s" | "30s" | "45s" | "1min" | "1min30" | "2min";

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
        className="shrink-0 w-6 h-6 flex items-center justify-center border border-[#2a2a3e] hover:border-[#00e5ff] hover:text-[#00e5ff] transition-none text-[#555577]"
        style={{ borderRadius: "2px" }}
      >
        {playing ? <Pause size={10} /> : <Play size={10} />}
      </button>
      <div
        className="flex-1 h-0.5 bg-[#1e1e2e] relative overflow-hidden cursor-pointer"
        style={{ borderRadius: "1px" }}
        onClick={handleSeek}
      >
        <div className="h-full bg-[#00e5ff]" style={{ width: `${progress}%` }} />
      </div>
      <span className="text-[10px] font-mono text-[#555577] shrink-0 tabular-nums">
        {formatTime(currentTime)}{duration ? `/${formatTime(duration)}` : ""}
      </span>
      {filename && (
        <a
          href={audioUrl}
          download={filename}
          className="shrink-0 text-[#555577] hover:text-[#00e5ff] transition-none"
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
  onCopy: () => void;
  onAdjust: (dur: AdjustDuration) => void;
  onRestore: () => void;
};

export function ScriptCard({
  section, content, stats, adjustDurations, isAdjusting, hasOverride,
  adjusting, audioState, isCopied, onCopy, onAdjust, onRestore,
}: Props) {
  return (
    <div className="bg-[#111118] border border-[#1e1e2e] overflow-hidden flex flex-col" style={{ borderRadius: "4px" }}>
      {/* Gradient top bar */}
      <div className="h-[2px] w-full shrink-0" style={{ background: "linear-gradient(90deg, #00e5ff, #ff3cac)" }} />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e1e2e]">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-[10px] font-mono font-semibold text-[#a0a0b8] tracking-widest uppercase shrink-0">
            {section}
          </span>
          {stats && (
            <span className="text-[10px] font-mono text-[#555577] shrink-0">
              {stats.words}w · {stats.duration}
            </span>
          )}
          {isAdjusting && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-[#555577] shrink-0">
              <span className="w-2 h-2 rounded-full bg-[#F59E0B] animate-pulse" />
              Réécriture…
            </span>
          )}
          {hasOverride && !isAdjusting && (
            <button
              onClick={onRestore}
              className="text-[10px] font-mono text-[#555577] hover:text-[#e0e0f0] transition-none shrink-0"
            >
              ↩ Original
            </button>
          )}
        </div>
        <button
          onClick={onCopy}
          className="text-[10px] font-mono text-[#555577] hover:text-[#00e5ff] transition-none shrink-0 ml-2"
        >
          {isCopied ? "Copié ✓" : "Copier"}
        </button>
      </div>

      {/* Body */}
      <div className="px-3 py-3 flex-1">
        <p className="text-[13px] font-mono text-[#e0e0f0] whitespace-pre-wrap leading-[1.7]">
          {content}
        </p>
      </div>

      {/* Audio player */}
      {audioState?.status === "done" && audioState.audioUrl && (
        <div className="px-3 py-2.5 border-t border-[#1e1e2e]">
          <AudioPlayer audioUrl={audioState.audioUrl} filename={audioState.filename} />
        </div>
      )}

      {/* Adjust durations */}
      <div className="px-3 py-2 border-t border-[#1e1e2e] flex flex-wrap gap-1">
        {adjustDurations.map((d) => (
          <button
            key={d}
            onClick={() => onAdjust(d)}
            disabled={adjusting}
            className="text-[10px] font-mono px-2 py-0.5 border border-[#1e1e2e] text-[#555577] hover:border-[#00e5ff] hover:text-[#00e5ff] disabled:opacity-40 transition-none"
            style={{ borderRadius: "2px" }}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}
