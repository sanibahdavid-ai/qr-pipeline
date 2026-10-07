"use client";

import { useState } from "react";
import { Copy, Check, ChevronDown, Undo2, Loader2 } from "lucide-react";
import type { Section, AudioState } from "../types";

type AdjustDuration = "10s" | "15s" | "30s" | "45s" | "1min30" | "2min";

const LANG_TITLES: Record<string, string> = {
  FR: "Script français",
  EN: "Script anglais",
  DE: "Script allemand",
  ES: "Script espagnol",
};

const DURATION_LABELS: Record<AdjustDuration, string> = {
  "10s": "10 s",
  "15s": "15 s",
  "30s": "30 s",
  "45s": "45 s",
  "1min30": "1 min 30",
  "2min": "2 min",
};

function scoreColor(score: number): string {
  if (score >= 80) return "var(--color-ok)";
  if (score >= 60) return "var(--color-warn)";
  return "var(--color-bad)";
}

function readableDuration(d: string): string {
  // "2min01s" -> "2 min 01", "45s" -> "45 s"
  return d.replace(/^(\d+)min(\d+)s$/, "$1 min $2").replace(/^(\d+)min$/, "$1 min").replace(/^(\d+)s$/, "$1 s");
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
  adjusting, isCopied, isAutoCorrection, onCopy, onAdjust,
  onAdjustCustom, onRestore, healthScore, healthFeedback,
}: Props) {
  const [customSec, setCustomSec] = useState("");
  const [textCopied, setTextCopied] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const lang = section.split(" ")[1] ?? "";

  async function copyTextOnly() {
    try {
      await navigator.clipboard.writeText(content);
      setTextCopied(true);
      setTimeout(() => setTextCopied(false), 1500);
    } catch {}
  }

  function submitCustom() {
    const sec = parseFloat(customSec);
    if (!isNaN(sec) && sec > 0 && onAdjustCustom) onAdjustCustom(sec);
  }

  return (
    <article className="flex flex-col rounded-[22px] bg-deck border border-line-soft dav-rise">
      {/* En-tête */}
      <header className="flex items-start gap-3 px-5 pt-5 pb-3">
        <span className="shrink-0 w-10 h-10 rounded-[13px] grid place-items-center bg-raised font-display text-[17px] font-semibold">
          {lang}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] font-semibold text-fg leading-tight">{LANG_TITLES[lang] ?? section}</h3>
          <p className="text-[13px] text-dim mt-1 flex items-center gap-2 flex-wrap">
            {stats && <span className="tabular-nums">{stats.words} mots, environ {readableDuration(stats.duration)}</span>}
            {isAdjusting && (
              <span className="inline-flex items-center gap-1.5 text-warn">
                <Loader2 size={12} className="animate-spin" /> Réécriture
              </span>
            )}
            {isAutoCorrection && !isAdjusting && (
              <span className="inline-flex items-center gap-1.5 text-accent-hi">
                <Loader2 size={12} className="animate-spin" /> Correction auto
              </span>
            )}
          </p>
        </div>
        <button
          onClick={onCopy}
          title="Copie le titre de section et le texte"
          className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-[13px] font-medium text-muted hover:text-fg hover:bg-raised transition-colors"
        >
          {isCopied ? <Check size={15} className="text-ok" /> : <Copy size={15} />}
          {isCopied ? "Copié" : "Copier"}
        </button>
      </header>

      {hasOverride && !isAdjusting && (
        <button
          onClick={onRestore}
          className="mx-5 mb-2 self-start inline-flex items-center gap-1.5 text-[13px] font-medium text-dim hover:text-fg transition-colors"
        >
          <Undo2 size={13} /> Revenir à la version d&apos;origine
        </button>
      )}

      {/* Texte */}
      <div className="px-5 pb-4 flex-1">
        <p className="text-[15.5px] text-fg/95 whitespace-pre-wrap leading-[1.72]">{content}</p>
      </div>

      {/* Copie du texte seul + score */}
      <div className="px-5 py-3.5 border-t border-line-soft flex items-center gap-4">
        {healthScore !== undefined ? (
          <div className="flex-1 min-w-0 flex items-center gap-3" title="Score de qualité de la réécriture">
            <div className="flex-1 max-w-[140px] h-1.5 rounded-full bg-line overflow-hidden">
              <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${healthScore}%`, background: scoreColor(healthScore) }} />
            </div>
            <span className="text-[14px] font-semibold tabular-nums" style={{ color: scoreColor(healthScore) }}>
              {healthScore}
              <span className="text-dim font-normal">/100</span>
            </span>
          </div>
        ) : (
          <div className="flex-1" />
        )}
        <button
          onClick={copyTextOnly}
          title="Copie uniquement le texte du script"
          className={`shrink-0 inline-flex items-center gap-2 h-10 px-4 rounded-xl text-[14px] font-semibold transition-colors ${
            textCopied ? "bg-ok/15 text-ok" : "bg-accent/15 text-accent-hi hover:bg-accent/25"
          }`}
        >
          {textCopied ? <Check size={15} /> : <Copy size={15} />}
          {textCopied ? "Texte copié" : "Copier le texte"}
        </button>
      </div>

      {healthFeedback && (
        <p className="px-5 pb-3 -mt-1 text-[13px] text-warn leading-snug">{healthFeedback}</p>
      )}

      {/* Ajuster la durée */}
      <div className="px-5 pb-4">
        <button
          onClick={() => setShowAdjust((v) => !v)}
          aria-expanded={showAdjust}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-dim hover:text-fg transition-colors"
        >
          <ChevronDown size={14} className={`transition-transform ${showAdjust ? "rotate-180" : ""}`} />
          Ajuster la durée
        </button>
        {showAdjust && (
          <div className="mt-3 flex flex-wrap gap-1.5 items-center">
            {adjustDurations.map((d) => (
              <button
                key={d}
                onClick={() => { onAdjust(d); setCustomSec(""); }}
                disabled={adjusting}
                className="h-8 px-3 rounded-full text-[13px] font-medium bg-raised text-muted hover:text-fg hover:bg-hover disabled:opacity-40 transition-colors"
              >
                {DURATION_LABELS[d]}
              </button>
            ))}
            {onAdjustCustom && (
              <label className="h-8 pl-3 pr-2 rounded-full bg-raised flex items-center gap-1 focus-within:shadow-[inset_0_0_0_1px_var(--color-accent)]">
                <input
                  type="number"
                  min={1}
                  max={600}
                  placeholder="Autre"
                  value={customSec}
                  onChange={(e) => setCustomSec(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitCustom(); }}
                  onBlur={submitCustom}
                  disabled={adjusting}
                  className="w-12 bg-transparent text-[13px] text-fg placeholder:text-dim focus:outline-none disabled:opacity-40"
                  aria-label="Durée personnalisée en secondes"
                />
                <span className="text-[13px] text-dim">s</span>
              </label>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
