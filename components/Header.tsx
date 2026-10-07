"use client";

import { useState, useEffect, useRef } from "react";
import { AudioLines, Clock, Command, LogOut, Link2, Check, X, ChevronRight, Plus } from "lucide-react";
import type { HistoryEntry, AuthUser, UserRole, Provider } from "../types";
import type { GenerationRow } from "../lib/supabase";
import { formatDate } from "../lib/format";

export const APP_VERSION = "8.0";

type Tab = "scripts" | "download";

const PROVIDER_NAMES: Record<Provider, string> = {
  "elevenlabs": "ElevenLabs Direct",
  "ai33-elevenlabs": "AI33 ElevenLabs",
  "ai33-minimax": "Minimax",
  "edge-tts": "Edge TTS",
  "google-tts": "Google Cloud",
  "google-ai-studio": "Google AI Studio",
};

const ROLE_NAMES: Record<NonNullable<UserRole>, string> = {
  DAV: "Directeur",
  ADMIN: "Admin",
  GUEST: "Invité",
};

function scoreTone(score: number): string {
  if (score >= 80) return "text-ok bg-ok/10";
  if (score >= 60) return "text-warn bg-warn/10";
  return "text-bad bg-bad/10";
}

type Props = {
  history: HistoryEntry[];
  showHistory: boolean;
  onToggleHistory: () => void;
  onRestoreHistory: (entry: HistoryEntry) => void;
  onDeleteHistory: (id: string, e: React.MouseEvent) => void;
  onClearHistory: () => void;
  canReset: boolean;
  onReset: () => void;
  onOpenPalette: () => void;
  historyPanelRef: React.RefObject<HTMLDivElement | null>;
  user: AuthUser | null;
  cloudHistory: GenerationRow[];
  onLogin: () => void;
  onLogout: () => void;
  onRestoreCloud: (gen: GenerationRow) => void;
  pinRole: UserRole;
  onPinLogout: () => void;
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
};

export function TabSwitch({ activeTab, onTabChange, className = "" }: { activeTab: Tab; onTabChange: (tab: Tab) => void; className?: string }) {
  return (
    <div className={`items-center p-1 rounded-full bg-deck border border-line-soft ${className}`} role="tablist">
      {(["scripts", "download"] as Tab[]).map((tab) => {
        const active = activeTab === tab;
        return (
          <button
            key={tab}
            role="tab"
            aria-selected={active}
            onClick={() => onTabChange(tab)}
            className={`flex-1 px-4 h-8 rounded-full text-[14px] font-medium transition-colors ${
              active ? "bg-raised text-fg shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-muted hover:text-fg"
            }`}
          >
            {tab === "scripts" ? "Scripts" : "Téléchargement"}
          </button>
        );
      })}
    </div>
  );
}

export function Header({
  history, showHistory, onToggleHistory, onRestoreHistory,
  onDeleteHistory, onClearHistory, canReset, onReset, onOpenPalette,
  historyPanelRef,
  user, cloudHistory, onRestoreCloud,
  pinRole, onPinLogout, activeTab, onTabChange,
}: Props) {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [copiedUrlId, setCopiedUrlId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const historyCount = user ? cloudHistory.length : history.length;
  const roleName = pinRole ? ROLE_NAMES[pinRole] : "";

  // Sans classe d'affichage : chaque bouton choisit la sienne (sinon "hidden" perd contre "inline-flex").
  const ghostBtn =
    "items-center gap-2 h-9 px-3 rounded-xl text-[14px] font-medium text-muted hover:text-fg hover:bg-raised transition-colors";

  return (
    <header className="sticky top-0 z-40 border-b border-line-soft bg-ink/85 backdrop-blur-xl">
      <div className="max-w-[1240px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        {/* Marque */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="w-9 h-9 shrink-0 rounded-[11px] grid place-items-center bg-gradient-to-br from-accent to-accent-deep text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
            <AudioLines size={18} strokeWidth={2.25} />
          </span>
          <span className="font-display text-[19px] sm:text-[22px] font-semibold tracking-[0.01em] leading-none truncate">
            DAV Pipeline
          </span>
          <span className="inline-flex shrink-0 items-center h-6 px-1.5 sm:px-2 rounded-full bg-raised text-[12px] font-medium text-muted tabular-nums">
            v{APP_VERSION}
          </span>
        </div>

        <TabSwitch activeTab={activeTab} onTabChange={onTabChange} className="hidden md:inline-flex" />

        {/* Actions */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          <button onClick={onOpenPalette} className={`${ghostBtn} hidden md:inline-flex`} title="Actions rapides (Ctrl K)">
            <Command size={15} />
            <span className="text-[13px]">K</span>
          </button>

          {/* Historique */}
          <div className="relative" ref={historyPanelRef}>
            <button onClick={onToggleHistory} className={`${ghostBtn} inline-flex px-2 sm:px-3 ${showHistory ? "bg-raised text-fg" : ""}`} aria-expanded={showHistory} aria-label="Historique">
              <Clock size={16} />
              <span className="hidden sm:inline">Historique</span>
              {historyCount > 0 && (
                <span className="min-w-6 h-6 px-1.5 rounded-full bg-accent/15 text-accent-hi text-[12px] font-semibold grid place-items-center tabular-nums">
                  {historyCount}
                </span>
              )}
            </button>

            {showHistory && (
              <div className="fixed inset-x-3 top-[72px] sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+10px)] sm:w-[440px] z-50 rounded-2xl bg-deck border border-line shadow-[0_28px_70px_-16px_rgba(0,0,0,0.75)] overflow-hidden dav-rise">
                <div className="flex items-center justify-between px-5 h-14 border-b border-line-soft">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-[19px] font-semibold">Historique</span>
                    {user && <span className="h-6 px-2 rounded-full bg-accent/15 text-accent-hi text-[12px] font-medium grid place-items-center">Cloud</span>}
                  </div>
                  {!user && history.length > 0 && (
                    <button onClick={onClearHistory} className="text-[13px] font-medium text-dim hover:text-bad transition-colors">
                      Tout effacer
                    </button>
                  )}
                </div>

                {user ? (
                  cloudHistory.length === 0 ? (
                    <p className="px-5 py-10 text-center text-[14px] text-dim">Aucune génération sauvegardée pour l&apos;instant.</p>
                  ) : (
                    <div className="max-h-[70vh] sm:max-h-[28rem] overflow-y-auto p-2">
                      {cloudHistory.map((gen) => (
                        <button
                          key={gen.id}
                          onClick={() => onRestoreCloud(gen)}
                          className="w-full text-left px-3 py-3 rounded-xl hover:bg-raised transition-colors"
                        >
                          <p className="text-[15px] font-medium text-fg truncate">{gen.video_title || "Sans titre"}</p>
                          <p className="text-[13px] text-dim mt-0.5">{formatDate(gen.created_at)}</p>
                        </button>
                      ))}
                    </div>
                  )
                ) : history.length === 0 ? (
                  <p className="px-5 py-10 text-center text-[14px] text-dim">Aucune vidéo générée pour l&apos;instant.</p>
                ) : (
                  <div className="max-h-[70vh] sm:max-h-[32rem] overflow-y-auto p-2">
                    {history.map((entry) => {
                      const words = entry.transcriptText ? entry.transcriptText.trim().split(/\s+/).filter(Boolean).length : 0;
                      const expanded = expandedId === entry.id;
                      return (
                        <div key={entry.id} className="group px-3 py-3 rounded-xl hover:bg-raised/70 transition-colors">
                          <div className="flex items-start gap-2 min-w-0">
                            <button onClick={() => onRestoreHistory(entry)} className="flex-1 min-w-0 text-left">
                              <p className="text-[15px] font-medium text-fg leading-snug line-clamp-2">
                                {entry.summaryTitle || entry.title || "Sans titre"}
                              </p>
                              <p className="text-[13px] text-dim mt-1">
                                {formatDate(entry.createdAt)}
                                <span className="text-line"> / </span>
                                {PROVIDER_NAMES[entry.provider] ?? entry.provider}
                              </p>
                            </button>
                            {entry.url && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(entry.url).then(() => {
                                    setCopiedUrlId(entry.id);
                                    setTimeout(() => setCopiedUrlId(null), 1200);
                                  });
                                }}
                                className="shrink-0 w-8 h-8 rounded-lg grid place-items-center text-dim hover:text-accent-hi hover:bg-hover transition-colors"
                                title="Copier le lien de la vidéo"
                              >
                                {copiedUrlId === entry.id ? <Check size={15} className="text-ok" /> : <Link2 size={15} />}
                              </button>
                            )}
                            <button
                              onClick={(e) => onDeleteHistory(entry.id, e)}
                              className="shrink-0 w-8 h-8 rounded-lg grid place-items-center text-dim hover:text-bad hover:bg-hover transition-colors"
                              title="Supprimer"
                            >
                              <X size={15} />
                            </button>
                          </div>

                          {entry.healthScores && Object.keys(entry.healthScores).length > 0 && (
                            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                              {(["FR", "EN", "DE", "ES"] as const).map((lang) => {
                                const score = entry.healthScores?.[lang];
                                if (score === undefined) return null;
                                return (
                                  <span key={lang} className={`h-6 px-2 rounded-full text-[12px] font-semibold grid place-items-center tabular-nums ${scoreTone(score)}`}>
                                    {lang} {score}
                                  </span>
                                );
                              })}
                            </div>
                          )}

                          <div className="flex items-center gap-3 mt-2">
                            {entry.transcriptText && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setExpandedId(expanded ? null : entry.id); }}
                                className="inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg transition-colors"
                                aria-expanded={expanded}
                              >
                                <ChevronRight size={14} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
                                Transcript, {words} mots
                              </button>
                            )}
                            <button
                              onClick={() => onRestoreHistory(entry)}
                              className="ml-auto text-[13px] font-semibold text-accent-hi hover:text-fg transition-colors"
                            >
                              Ouvrir
                            </button>
                          </div>

                          {expanded && entry.transcriptText && (
                            <p className="mt-2 p-3 rounded-lg bg-ink/60 text-[13px] text-muted leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap">
                              {entry.transcriptText}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Profil */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setShowUserMenu((v) => !v)}
              className={`inline-flex items-center gap-2 h-9 px-1 sm:pl-1.5 sm:pr-3 rounded-full border transition-colors ${
                showUserMenu ? "bg-raised border-line" : "border-line-soft hover:bg-raised"
              }`}
              aria-expanded={showUserMenu}
            >
              <span
                className={`h-6 px-2 rounded-full grid place-items-center text-[12px] font-bold ${
                  pinRole === "DAV" ? "bg-accent text-ink" : pinRole === "ADMIN" ? "bg-warn text-ink" : "bg-dim text-ink"
                }`}
              >
                {pinRole === "DAV" ? "DAV" : pinRole === "ADMIN" ? "ADM" : "INV"}
              </span>
              <span className="hidden sm:inline text-[14px] font-medium text-muted">{roleName}</span>
            </button>

            {showUserMenu && (
              <div className="absolute right-0 top-[calc(100%+10px)] w-60 z-50 rounded-2xl bg-deck border border-line shadow-[0_28px_70px_-16px_rgba(0,0,0,0.75)] overflow-hidden p-2 dav-rise">
                <div className="px-3 py-2.5">
                  <p className="text-[15px] font-semibold text-fg">Profil {roleName.toLowerCase()}</p>
                  <p className="text-[13px] text-dim mt-0.5">
                    {pinRole === "DAV" ? "Génération audio activée" : "Génération audio réservée au directeur"}
                  </p>
                </div>
                <button
                  onClick={() => { setShowUserMenu(false); onPinLogout(); }}
                  className="w-full flex items-center gap-2.5 px-3 h-10 rounded-xl text-[14px] font-medium text-muted hover:text-bad hover:bg-raised transition-colors"
                >
                  <LogOut size={15} />
                  Changer de profil
                </button>
              </div>
            )}
          </div>

          {canReset && (
            <button onClick={onReset} className={`${ghostBtn} inline-flex px-2 sm:px-3`} title="Nouvelle vidéo" aria-label="Nouvelle vidéo">
              <Plus size={16} />
              <span className="hidden sm:inline">Nouveau</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
