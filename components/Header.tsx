"use client";

import { useState, useEffect, useRef } from "react";
import { Clock, RotateCcw, Command, LogIn, LogOut } from "lucide-react";
import type { HistoryEntry, AuthUser } from "../types";
import type { GenerationRow } from "../lib/supabase";
import { formatDate } from "../lib/format";

const APP_VERSION = "3.0";
const CTA_POSITIONS = [2, 3, 4] as const;

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
  ctaEnabled: boolean;
  ctaPosition: number;
  onCtaPositionChange: (pos: number) => void;
  onCtaToggle: () => void;
  user: AuthUser | null;
  cloudHistory: GenerationRow[];
  onLogin: () => void;
  onLogout: () => void;
  onRestoreCloud: (gen: GenerationRow) => void;
};

export function Header({
  history, showHistory, onToggleHistory, onRestoreHistory,
  onDeleteHistory, onClearHistory, canReset, onReset, onOpenPalette,
  historyPanelRef, ctaEnabled, ctaPosition, onCtaPositionChange, onCtaToggle,
  user, cloudHistory, onLogin, onLogout, onRestoreCloud,
}: Props) {
  const [showCtaPopover, setShowCtaPopover] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const ctaPopoverRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ctaPopoverRef.current && !ctaPopoverRef.current.contains(e.target as Node)) {
        setShowCtaPopover(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelectPosition(pos: number) {
    onCtaPositionChange(pos);
    setShowCtaPopover(false);
  }

  function handleDisable() {
    onCtaToggle();
    setShowCtaPopover(false);
  }

  const displayName = user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? user?.email ?? "";
  const avatarUrl = user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture ?? "";

  const historyCount = user ? cloudHistory.length : history.length;

  return (
    <header
      className="sticky top-0 z-40 border-b border-[#1e1e2e]"
      style={{ background: "rgba(10,10,15,0.9)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
    >
      <div className="max-w-5xl mx-auto px-4 h-12 flex items-center justify-between gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <span
            className="text-[14px] font-bold tracking-tight"
            style={{
              fontFamily: "var(--font-syne)",
              background: "linear-gradient(135deg, #00e5ff, #ff3cac)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            DAV PIPELINE
          </span>
          <span
            className="text-[10px] font-mono text-[#555577] border border-[#1e1e2e] px-1.5 py-0.5"
            style={{ borderRadius: "2px" }}
          >
            v{APP_VERSION}
          </span>

          {/* Hidden CTA toggle */}
          <div className="relative" ref={ctaPopoverRef}>
            <button
              onClick={() => setShowCtaPopover((v) => !v)}
              tabIndex={-1}
              aria-hidden="true"
              className="relative flex items-center justify-center w-3.5 h-3.5 text-[#111118] hover:text-[#1e1e2e] transition-none select-none"
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1 }}
            >
              <span className="font-mono text-[11px]">·</span>
              {ctaEnabled && (
                <span
                  className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-[#00e5ff]"
                  style={{ transform: "translate(30%, -30%)" }}
                />
              )}
            </button>

            {showCtaPopover && (
              <div
                className="absolute top-full left-0 mt-1.5 z-[60] w-28 bg-[#111118] border border-[#1e1e2e] overflow-hidden shadow-xl"
                style={{ borderRadius: "4px" }}
              >
                <div className="h-[2px] w-full" style={{ background: "linear-gradient(90deg, #00e5ff, #ff3cac)" }} />
                <div className="py-1">
                  {CTA_POSITIONS.map((pos) => (
                    <button
                      key={pos}
                      onClick={() => handleSelectPosition(pos)}
                      className={`w-full text-left px-3 py-1.5 text-[11px] font-mono transition-none flex items-center justify-between ${
                        ctaEnabled && ctaPosition === pos
                          ? "text-[#00e5ff] bg-[#0a1a1f]"
                          : "text-[#a0a0b8] hover:bg-[#16161f] hover:text-[#e0e0f0]"
                      }`}
                    >
                      Phrase {pos}
                      {ctaEnabled && ctaPosition === pos && (
                        <span className="w-1 h-1 rounded-full bg-[#00e5ff] shrink-0" />
                      )}
                    </button>
                  ))}
                  {ctaEnabled && (
                    <>
                      <div className="mx-3 my-1 h-px bg-[#1e1e2e]" />
                      <button
                        onClick={handleDisable}
                        className="w-full text-left px-3 py-1.5 text-[11px] font-mono text-[#555577] hover:text-[#ff4466] hover:bg-[#16161f] transition-none"
                      >
                        Désactiver
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Command palette trigger */}
          <button
            onClick={onOpenPalette}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono text-[#555577] border border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-[#e0e0f0] transition-none"
            style={{ borderRadius: "2px" }}
            title="⌘K — Command palette"
          >
            <Command size={11} />
            <span className="hidden sm:inline">⌘K</span>
          </button>

          {/* History */}
          <div className="relative" ref={historyPanelRef}>
            <button
              onClick={onToggleHistory}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono text-[#555577] border border-[#1e1e2e] hover:border-[#2a2a3e] hover:text-[#e0e0f0] transition-none"
              style={{ borderRadius: "2px" }}
            >
              <Clock size={11} />
              <span className="hidden sm:inline">Historique</span>
              {historyCount > 0 && (
                <span
                  className="bg-[#1e1e2e] text-[#a0a0b8] px-1 text-[9px] font-mono"
                  style={{ borderRadius: "2px" }}
                >
                  {historyCount}
                </span>
              )}
            </button>

            {showHistory && (
              <div
                className="absolute right-0 top-9 w-80 bg-[#111118] border border-[#1e1e2e] shadow-2xl z-50 overflow-hidden"
                style={{ borderRadius: "4px" }}
              >
                <div className="h-[2px] w-full" style={{ background: "linear-gradient(90deg, #00e5ff, #ff3cac)" }} />
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e1e2e]">
                  <span className="text-[10px] font-mono font-semibold text-[#a0a0b8] tracking-widest uppercase flex items-center gap-1.5">
                    Historique
                    {user && (
                      <span className="text-[#00e5ff]">· Cloud</span>
                    )}
                  </span>
                  {!user && history.length > 0 && (
                    <button
                      onClick={onClearHistory}
                      className="text-[10px] font-mono text-[#555577] hover:text-[#ff4466] transition-none"
                    >
                      Tout effacer
                    </button>
                  )}
                </div>

                {/* Cloud history when logged in */}
                {user ? (
                  cloudHistory.length === 0 ? (
                    <div className="px-4 py-8 text-center text-[11px] font-mono text-[#555577]">
                      Aucune génération sauvegardée
                    </div>
                  ) : (
                    <div className="max-h-80 overflow-y-auto divide-y divide-[#1e1e2e]">
                      {cloudHistory.map((gen) => (
                        <div
                          key={gen.id}
                          onClick={() => onRestoreCloud(gen)}
                          className="flex items-start gap-2 px-4 py-2.5 hover:bg-[#16161f] cursor-pointer transition-none"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] text-[#e0e0f0] truncate font-medium leading-snug">
                              {gen.video_title || "Sans titre"}
                            </p>
                            <p className="text-[10px] text-[#555577] font-mono mt-0.5">
                              {formatDate(gen.created_at)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  /* Local history when not logged in */
                  history.length === 0 ? (
                    <div className="px-4 py-8 text-center text-[11px] font-mono text-[#555577]">
                      Aucune vidéo générée
                    </div>
                  ) : (
                    <div className="max-h-80 overflow-y-auto divide-y divide-[#1e1e2e]">
                      {history.map((entry) => (
                        <div
                          key={entry.id}
                          onClick={() => onRestoreHistory(entry)}
                          className="group flex items-start gap-2 px-4 py-2.5 hover:bg-[#16161f] cursor-pointer transition-none"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] text-[#e0e0f0] truncate font-medium leading-snug">
                              {entry.title || "Sans titre"}
                            </p>
                            <p className="text-[10px] text-[#555577] font-mono mt-0.5">
                              {formatDate(entry.date)} · {entry.provider}
                            </p>
                          </div>
                          <button
                            onClick={(e) => onDeleteHistory(entry.id, e)}
                            className="opacity-0 group-hover:opacity-100 text-[#555577] hover:text-[#ff4466] transition-none shrink-0 mt-0.5"
                          >
                            <span className="text-xs">×</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          {/* Auth */}
          {user ? (
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setShowUserMenu((v) => !v)}
                className="flex items-center gap-1.5 px-2 py-1 border border-[#1e1e2e] hover:border-[#2a2a3e] transition-none"
                style={{ borderRadius: "2px" }}
                title={displayName}
              >
                {avatarUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={avatarUrl} alt="" className="w-5 h-5 rounded-full" />
                ) : (
                  <span className="w-5 h-5 rounded-full bg-[#1e1e2e] flex items-center justify-center text-[9px] font-mono text-[#a0a0b8]">
                    {displayName.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="hidden sm:inline text-[11px] font-mono text-[#a0a0b8] max-w-[80px] truncate">
                  {displayName.split(" ")[0]}
                </span>
              </button>

              {showUserMenu && (
                <div
                  className="absolute right-0 top-9 w-44 bg-[#111118] border border-[#1e1e2e] shadow-xl z-50 overflow-hidden"
                  style={{ borderRadius: "4px" }}
                >
                  <div className="h-[2px] w-full" style={{ background: "linear-gradient(90deg, #00e5ff, #ff3cac)" }} />
                  <div className="px-3 py-2 border-b border-[#1e1e2e]">
                    <p className="text-[11px] font-mono text-[#e0e0f0] truncate">{displayName}</p>
                    <p className="text-[10px] font-mono text-[#555577] truncate">{user.email}</p>
                  </div>
                  <button
                    onClick={() => { setShowUserMenu(false); onLogout(); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-mono text-[#555577] hover:text-[#ff4466] hover:bg-[#16161f] transition-none"
                  >
                    <LogOut size={11} />
                    Déconnexion
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={onLogin}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono text-[#555577] border border-[#1e1e2e] hover:border-[#00e5ff] hover:text-[#00e5ff] transition-none"
              style={{ borderRadius: "2px" }}
              title="Connexion avec Google"
            >
              <LogIn size={11} />
              <span className="hidden sm:inline">Google</span>
            </button>
          )}

          {/* Reset */}
          {canReset && (
            <button
              onClick={onReset}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono text-[#555577] hover:text-[#e0e0f0] transition-none"
            >
              <RotateCcw size={11} />
              <span className="hidden sm:inline">Reset</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
