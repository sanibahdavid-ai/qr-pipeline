"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useState, useRef } from "react";

type Platform = "YT" | "TT" | "IG" | null;

function detectPlatform(url: string): Platform {
  if (/youtube\.com|youtu\.be/.test(url)) return "YT";
  if (/tiktok\.com/.test(url)) return "TT";
  if (/instagram\.com/.test(url)) return "IG";
  return null;
}

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
      // Small delay so the value updates first
      setTimeout(() => onSubmit(), 50);
    }
  }

  return (
    <div className="space-y-2">
      <div className="relative flex items-center">
        {/* Platform badge */}
        {platform && (
          <div className="absolute left-3 flex items-center">
            <span className="text-[10px] font-mono font-semibold text-[#0A0A0A] bg-[#F5F5F5] px-1.5 py-0.5" style={{ borderRadius: "3px" }}>
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
          className={`w-full h-12 bg-[#141414] border text-sm font-mono placeholder-[#525252] text-[#F5F5F5] focus:outline-none focus:border-[#404040] pr-14 transition-none ${
            isLoading ? "border-[#404040] animate-pulse" : error ? "border-[#EF4444]" : "border-[#262626]"
          } ${platform ? "pl-12" : "pl-4"}`}
          style={{ borderRadius: "8px" }}
          disabled={isLoading}
        />

        <button
          onClick={onSubmit}
          disabled={!value.trim() || isLoading}
          className="absolute right-2 flex items-center justify-center w-8 h-8 bg-[#F5F5F5] text-[#0A0A0A] disabled:opacity-40 hover:bg-[#A3A3A3] transition-none"
          style={{ borderRadius: "4px" }}
        >
          {isLoading
            ? <Loader2 size={14} className="animate-spin" />
            : <ArrowRight size={14} />}
        </button>
      </div>

      {error && (
        <p className="text-[12px] font-mono text-[#EF4444]">{error}</p>
      )}
    </div>
  );
}
