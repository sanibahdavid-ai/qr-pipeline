"use client";

import { ArrowRight, Loader2, ClipboardPaste } from "lucide-react";
import { useState, useRef } from "react";
import { toast } from "sonner";

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
          <div className="absolute left-3 flex items-center">
            <span className="text-[10px] font-mono font-semibold text-[#FFFFFF] bg-[#D97757] px-1.5 py-0.5" style={{ borderRadius: "3px" }}>
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
          className={`w-full h-12 bg-[#2F2F2C] border text-sm font-mono placeholder-[#7D7A72] text-[#F0EEE6] focus:outline-none focus:border-[#5C5851] pr-[84px] transition-none ${
            isLoading ? "border-[#5C5851] animate-pulse" : error ? "border-[#EF4444]" : "border-[#44423D]"
          } ${platform ? "pl-12" : "pl-4"}`}
          style={{ borderRadius: "8px" }}
          disabled={isLoading}
        />

        {/* Paste button */}
        <button
          onClick={handleClickPaste}
          disabled={isLoading}
          title="Coller depuis le presse-papier"
          className="absolute right-[44px] flex items-center justify-center w-8 h-8 border border-[#44423D] text-[#7D7A72] hover:border-[#5C5851] hover:text-[#F0EEE6] disabled:opacity-40 transition-none"
          style={{ borderRadius: "4px" }}
        >
          <ClipboardPaste size={13} />
        </button>

        {/* Submit button */}
        <button
          onClick={onSubmit}
          disabled={!value.trim() || isLoading}
          className="absolute right-2 flex items-center justify-center w-8 h-8 bg-[#D97757] text-[#FFFFFF] disabled:opacity-40 hover:bg-[#C56646] transition-none"
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
