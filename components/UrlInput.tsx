"use client";

import { ArrowRight, Loader2, ClipboardPaste, Link2 } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

type Platform = "YT" | "TT" | "IG" | null;

function detectPlatform(url: string): Platform {
  if (/youtube\.com|youtu\.be/.test(url)) return "YT";
  if (/tiktok\.com/.test(url)) return "TT";
  if (/instagram\.com/.test(url)) return "IG";
  return null;
}

const PLATFORM_LABEL: Record<NonNullable<Platform>, { name: string; className: string }> = {
  YT: { name: "YouTube", className: "bg-[#ff3b47]/15 text-[#ff8a92]" },
  TT: { name: "TikTok", className: "bg-fg/10 text-fg" },
  IG: { name: "Instagram", className: "bg-[#d6409f]/15 text-[#f08bc9]" },
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
    // Entrée envoie, Maj+Entrée va à la ligne
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (manualText.trim()) onManualSubmit();
    }
  }

  return (
    <div className="space-y-5">
      {/* Lien vidéo : le point de départ de tout */}
      <div>
        <div
          className={`group flex items-center gap-2 p-2 rounded-[22px] bg-deck border transition-[border-color,box-shadow] duration-200 ${
            error
              ? "border-bad/60"
              : isLoading
              ? "border-accent/40"
              : "border-line focus-within:border-accent/70 focus-within:shadow-[0_0_0_4px_rgba(76,141,255,0.12),0_24px_60px_-24px_rgba(76,141,255,0.45)]"
          }`}
        >
          <span className="pl-2.5 shrink-0">
            {platform ? (
              <span className={`h-7 px-2.5 rounded-full text-[13px] font-semibold grid place-items-center ${PLATFORM_LABEL[platform].className}`}>
                {PLATFORM_LABEL[platform].name}
              </span>
            ) : (
              <Link2 size={18} className="text-dim" />
            )}
          </span>

          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Colle un lien vidéo"
            className="flex-1 min-w-0 h-12 bg-transparent text-[16px] text-fg placeholder:text-dim focus:outline-none"
            disabled={isLoading}
            aria-label="Lien de la vidéo"
          />

          <button
            onClick={handleClickPaste}
            disabled={isLoading}
            title="Coller depuis le presse-papier"
            className="shrink-0 inline-flex items-center gap-2 h-11 px-3 sm:px-4 rounded-[14px] text-[14px] font-medium text-muted hover:text-fg hover:bg-raised disabled:opacity-40 transition-colors"
          >
            <ClipboardPaste size={16} />
            <span className="hidden sm:inline">Coller</span>
          </button>

          <button
            onClick={onSubmit}
            disabled={!value.trim() || isLoading}
            aria-label="Extraire le transcript"
            className="shrink-0 w-11 h-11 rounded-[14px] grid place-items-center bg-accent-deep text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] hover:bg-accent disabled:bg-raised disabled:text-dim disabled:shadow-none transition-colors"
          >
            {isLoading ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
          </button>
        </div>

        {error && <p className="mt-2.5 px-2 text-[14px] text-bad">{error}</p>}
        {isLoading && <p className="mt-2.5 px-2 text-[14px] text-muted">Extraction du transcript en cours…</p>}
      </div>

      {/* Transcript collé à la main */}
      <div>
        <p className="px-2 mb-2 text-[14px] text-dim">Ou colle directement un transcript</p>
        <div className="relative rounded-[18px] bg-deck/60 border border-line-soft focus-within:border-accent/50 transition-colors">
          <textarea
            value={manualText}
            onChange={(e) => onManualChange(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            placeholder="Le texte de la vidéo…"
            className="block w-full bg-transparent text-[15px] leading-relaxed text-fg placeholder:text-dim focus:outline-none px-4 py-3.5 pr-16 resize-y"
            style={{ minHeight: "92px", maxHeight: "260px" }}
            disabled={isLoading}
            aria-label="Transcript"
          />
          <button
            onClick={() => { if (manualText.trim() && !isLoading) onManualSubmit(); }}
            disabled={!manualText.trim() || isLoading}
            aria-label="Réécrire ce transcript"
            className="absolute right-2.5 bottom-2.5 w-10 h-10 rounded-[12px] grid place-items-center bg-accent-deep text-white hover:bg-accent disabled:bg-raised disabled:text-dim transition-colors"
          >
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
