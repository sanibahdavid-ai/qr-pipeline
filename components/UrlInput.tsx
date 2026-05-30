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
};

export function UrlInput({ value, onChange, onSubmit, isLoading, error }: Props) {
  const platform = detectPlatform(value);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") onSubmit();
  }

  function handlePaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData("text");
    if (detectPlatform(pasted)) {
      setTimeout(() => onSubmit(), 50);
    }
  }

  async function handleClickPaste() {
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      onChange(trimmed);
      if (detectPlatform(trimmed)) {
        setTimeout(() => onSubmit(), 80);
      }
    } catch {
      toast.error("Impossible de lire le presse-papier");
    }
  }

  return (
    <div className="space-y-2">
      <div className="relative flex items-center">
        {/* Platform badge */}
        {platform && (
          <div className="absolute left-3 flex items-center z-10">
            <span
              className="text-[10px] font-mono font-semibold text-[#e0e0f0] px-1.5 py-0.5"
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
          className={`w-full h-12 bg-[#0d0d15] border text-sm font-mono placeholder-[#555577] text-[#e0e0f0] focus:outline-none pr-[84px] transition-none ${
            isLoading
              ? "border-[#2a2a3e] animate-pulse"
              : error
              ? "border-[#ff4466]"
              : "border-[#1e1e2e] focus:border-[#00e5ff]"
          } ${platform ? "pl-12" : "pl-4"}`}
          style={{ borderRadius: "2px" }}
          disabled={isLoading}
        />

        {/* Paste button */}
        <button
          onClick={handleClickPaste}
          disabled={isLoading}
          title="Coller depuis le presse-papier"
          className="absolute right-[44px] flex items-center justify-center w-8 h-8 border border-[#1e1e2e] text-[#555577] hover:border-[#00e5ff] hover:text-[#00e5ff] disabled:opacity-40 transition-none"
          style={{ borderRadius: "2px" }}
        >
          <ClipboardPaste size={13} />
        </button>

        {/* Submit button — cyan-to-blue gradient */}
        <button
          onClick={onSubmit}
          disabled={!value.trim() || isLoading}
          className="absolute right-2 flex items-center justify-center w-8 h-8 text-black disabled:opacity-40 transition-none"
          style={{
            background: "linear-gradient(135deg, #00e5ff, #0077ff)",
            borderRadius: "2px",
          }}
        >
          {isLoading
            ? <Loader2 size={14} className="animate-spin text-black" />
            : <ArrowRight size={14} />}
        </button>
      </div>

      {error && (
        <p className="text-[12px] font-mono text-[#ff4466]">{error}</p>
      )}
    </div>
  );
}
