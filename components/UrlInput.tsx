"use client";

import { ArrowRight, Loader2, ClipboardPaste } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

type Platform = "YT" | "TT" | "IG" | null;

function detectPlatform(url: string): Platform {
  if (/youtube\.com|youtu\.be/.test(url)) return "YT";
  if (/tiktok\.com/.test(url)) return "TT";
  if (/instagram\.com/.test(url)) return "IG";
  return null;
}

const PLATFORM_COLORS: Record<NonNullable<Platform>, string> = {
  YT: "#FF0000",
  TT: "#010101",
  IG: "#C13584",
};

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  error?: string;
  manualText: string;
  onManualChange: (v: string) => void;
  onManualSubmit: () => void;
};

export function UrlInput({
  value, onChange, onSubmit, isLoading, error,
  manualText, onManualChange, onManualSubmit,
}: Props) {
  const platform = detectPlatform(value);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") onSubmit();
  }

  function handlePaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData("text");
    if (detectPlatform(pasted)) setTimeout(() => onSubmit(), 50);
  }

  async function handleClickPaste() {
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      onChange(trimmed);
      if (detectPlatform(trimmed)) setTimeout(() => onSubmit(), 80);
    } catch {
      toast.error("Impossible de lire le presse-papier");
    }
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Plain Enter submits; Shift+Enter inserts newline
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (manualText.trim()) onManualSubmit();
    }
  }

  return (
    <div className="space-y-2">
      {/* ── URL input ── */}
      <div className="relative flex items-center">
        {platform && (
          <div className="absolute left-3 flex items-center z-10">
            <span
              className="text-[10px] font-mono font-semibold text-[#e0eef8] px-1.5 py-0.5"
              style={{ borderRadius: "2px", background: PLATFORM_COLORS[platform] }}
            >
              {platform}
            </span>
          </div>
        )}

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="youtube.com/watch?v=…  ·  tiktok.com/@…  ·  instagram.com/p/…"
          className={`w-full h-12 bg-[#0a1420] border text-sm font-mono placeholder-[#4a6a8a] text-[#e0eef8] focus:outline-none pr-[84px] transition-none ${
            isLoading
              ? "border-[#2a4a75] animate-pulse"
              : error
              ? "border-[#ff4466]"
              : "border-[#1a2942] focus:border-[#00b4ff]"
          } ${platform ? "pl-12" : "pl-4"}`}
          style={{ borderRadius: "2px" }}
          disabled={isLoading}
        />

        <button
          onClick={handleClickPaste}
          disabled={isLoading}
          title="Coller depuis le presse-papier"
          className="absolute right-[44px] flex items-center justify-center w-8 h-8 border border-[#1a2942] text-[#4a6a8a] hover:border-[#00b4ff] hover:text-[#00b4ff] disabled:opacity-40 transition-none"
          style={{ borderRadius: "2px" }}
        >
          <ClipboardPaste size={13} />
        </button>

        <button
          onClick={onSubmit}
          disabled={!value.trim() || isLoading}
          className="absolute right-2 flex items-center justify-center w-8 h-8 text-black disabled:opacity-40 transition-none"
          style={{ background: "linear-gradient(135deg, #00b4ff, #0084d1)", borderRadius: "2px" }}
        >
          {isLoading
            ? <Loader2 size={14} className="animate-spin text-black" />
            : <ArrowRight size={14} />}
        </button>
      </div>

      {error && <p className="text-[12px] font-mono text-[#ff4466]">{error}</p>}

      {/* ── OU divider ── */}
      <div className="flex items-center gap-3 py-1">
        <div className="flex-1 h-px bg-[#1a2942]" />
        <span className="text-[10px] font-mono font-semibold text-[#4a6a8a] tracking-widest">OU</span>
        <div className="flex-1 h-px bg-[#1a2942]" />
      </div>

      {/* ── Manual transcript textarea ── */}
      <div className="relative">
        <textarea
          value={manualText}
          onChange={(e) => onManualChange(e.target.value)}
          onKeyDown={handleTextareaKeyDown}
          placeholder="Colle ton transcript ici..."
          className={`w-full bg-[#0a1420] border text-sm font-mono placeholder-[#4a6a8a] text-[#e0eef8] focus:outline-none px-4 py-3 pr-12 resize-y transition-none ${
            isLoading
              ? "border-[#2a4a75] opacity-50"
              : "border-[#1a2942] focus:border-[#00b4ff]"
          }`}
          style={{ borderRadius: "2px", minHeight: "80px", maxHeight: "200px" }}
          disabled={isLoading}
        />
        <button
          onClick={() => { if (manualText.trim() && !isLoading) onManualSubmit(); }}
          disabled={!manualText.trim() || isLoading}
          className="absolute right-2 bottom-2 flex items-center justify-center w-8 h-8 text-black disabled:opacity-40 transition-none"
          style={{ background: "linear-gradient(135deg, #00b4ff, #0084d1)", borderRadius: "2px" }}
        >
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
