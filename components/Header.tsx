"use client";

import { useState, useEffect, useRef } from "react";
import { Clock, RotateCcw, Command, LogIn, LogOut } from "lucide-react";
import type { HistoryEntry, AuthUser } from "../types";
import type { GenerationRow } from "../lib/supabase";
import { formatDate } from "../lib/format";

const APP_VERSION = "5.2";

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
  audioEnabled: boolean;
  onAudioToggle: () => void;
  user: AuthUser | null;
  cloudHistory: GenerationRow[];
  onLogin: () => void;
  onLogout: () => void;
  onRestoreCloud: (gen: GenerationRow) => void;
};

export function Header({
  history, showHistory, onToggleHistory, onRestoreHistory,
  onDeleteHistory, onClearHistory, canReset, onReset, onOpenPalette,
  historyPanelRef, audioEnabled, onAudioToggle,
  user, cloudHistory, onLogin, onLogout, onRestoreCloud,
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

  const displayName = user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? user?.email ?? "";
  const avatarUrl = user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture ?? "";

  const historyCount = user ? cloudHistory.length : history.length;

  return (
    <header
      className="sticky top-0 z-40 border-b border-[#1a2942]"
      style={{ background: "rgba(6,10,18,0.9)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
    >
      <div className="max-w-5xl mx-auto px-4 h-12 flex items-center justify-between gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <span
            className="text-[14px] font-bold tracking-tight"
            style={{
              fontFamily: "var(--font-syne)",
              background: "linear-gradient(135deg, #00b4ff, #ff3cac)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            DAV PIPELINE
          </span>
          <span
            className="text-[10px] font-mono text-[#4a6a8a] border border-[#1a2942] px-1.5 py-0.5"
            style={{ borderRadius: "2px" }}
          >
            v{APP_VERSION}
          </span>

          {/* Hidden audio toggle — invisible when off, small blue dot when on */}
          <button
            onClick={onAudioToggle}
            tabIndex={-1}
            aria-hidden="true"
            className="w-2 h-2 shrink-0 select-none"
            style={{
              background: audioEnabled ? "#3b82f6" : "transparent",
              border: "none",
              borderRadius: "50%",
              padding: 0,
              cursor: "pointer",
            }}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Command palette trigger */}
          <button
            onClick={onOpenPalette}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono text-[#4a6a8a] border border-[#1a2942] hover:border-[#2a4a75] hover:text-[#e0eef8] transition-none"
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
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono text-[#4a6a8a] border border-[#1a2942] hover:border-[#2a4a75] hover:text-[#e0eef8] transition-none"
              style={{ borderRadius: "2px" }}
            >
              <Clock size={11} />
              <span className="hidden sm:inline">Historique</span>
              {historyCount > 0 && (
                <span
                  className="bg-[#1a2942] text-[#7a9ac2] px-1 text-[9px] font-mono"
                  style={{ borderRadius: "2px" }}
                >
                  {historyCount}
                </span>
              )}
            </button>

            {showHistory && (
              <div
                className="absolute right-0 top-9 w-96 bg-[#0d1420] border border-[#1a2942] shadow-2xl z-50 overflow-hidden"
                style={{ borderRadius: "4px" }}
              >
                <div className="h-[2px] w-full" style={{ background: "linear-gradient(90deg, #00b4ff, #ff3cac)" }} />
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1a2942]">
                  <span className="text-[10px] font-mono font-semibold text-[#7a9ac2] tracking-widest uppercase flex items-center gap-1.5">
                    Historique
                    {user && (
                      <span className="text-[#00b4ff]">· Cloud</span>
                    )}
                  </span>
                  {!user && history.length > 0 && (
                    <button
                      onClick={onClearHistory}
                      className="text-[10px] font-mono text-[#4a6a8a] hover:text-[#ff4466] transition-none"
                    >
                      Tout effacer
                    </button>
                  )}
                </div>

                {/* Cloud history when logged in */}
                {user ? (
                  cloudHistory.length === 0 ? (
                    <div className="px-4 py-8 text-center text-[11px] font-mono text-[#4a6a8a]">
                      Aucune génération sauvegardée
                    </div>
                  ) : (
                    <div className="max-h-80 overflow-y-auto divide-y divide-[#1a2942]">
                      {cloudHistory.map((gen) => (
                        <div
                          key={gen.id}
                          onClick={() => onRestoreCloud(gen)}
                          className="flex items-start gap-2 px-4 py-2.5 hover:bg-[#13233a] cursor-pointer transition-none"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] text-[#e0eef8] truncate font-medium leading-snug">
                              {gen.video_title || "Sans titre"}
                            </p>
                            <p className="text-[10px] text-[#4a6a8a] font-mono mt-0.5">
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
                    <div className="px-4 py-8 text-center text-[11px] font-mono text-[#4a6a8a]">
                      Aucune vidéo générée
                    </div>
                  ) : (
                    <div className="max-h-[32rem] overflow-y-auto divide-y divide-[#1a2942]">
                      {history.map((entry) => (
                        <div key={entry.id} className="flex flex-col px-4 py-3 hover:bg-[#13233a] transition-none">
                          {/* Title + URL copy + delete */}
                          <div className="flex items-start gap-2 min-w-0">
                            <button
                              onClick={() => onRestoreHistory(entry)}
                              className="flex-1 min-w-0 text-left"
                            >
                              <p className="text-[12px] text-[#e0eef8] truncate font-medium leading-snug">
                                {entry.title || "Sans titre"}
                              </p>
                            </button>
                            {entry.url && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(entry.url).then(() => {
                                    setCopiedUrlId(entry.id);
                                    setTimeout(() => setCopiedUrlId(null), 1000);
                                  });
                                }}
                                className="shrink-0 text-[11px] font-mono text-[#4a6a8a] hover:text-[#00b4ff] transition-none"
                                title="Copier le lien"
                              >
                                {copiedUrlId === entry.id ? "✓" : "🔗"}
                              </button>
                            )}
                            <button
                              onClick={(e) => onDeleteHistory(entry.id, e)}
                              className="shrink-0 text-[#4a6a8a] hover:text-[#ff4466] transition-none"
                            >
                              <span className="text-xs">×</span>
                            </button>
                          </div>

                          {/* Date + provider */}
                          <p className="text-[10px] text-[#4a6a8a] font-mono mt-0.5">
                            {formatDate(entry.createdAt)} · {entry.provider}
                          </p>

                          {/* Health score badges */}
                          {entry.healthScores && Object.keys(entry.healthScores).length > 0 && (
                            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                              {(["FR", "EN", "DE", "ES"] as const).map((lang) => {
                                const score = entry.healthScores?.[lang];
                                if (score === undefined) return null;
                                const color = score >= 80 ? "#00b4ff" : score >= 60 ? "#F59E0B" : "#ff4466";
                                return (
                                  <span
                                    key={lang}
                                    className="text-[9px] font-mono px-1 py-px border"
                                    style={{ borderRadius: "2px", borderColor: color, color }}
                                  >
                                    {lang} {score}
                                  </span>
                                );
                              })}
                            </div>
                          )}

                          {/* Transcript preview */}
                          {entry.transcriptText && (
                            <div className="mt-1.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedId(expandedId === entry.id ? null : entry.id);
                                }}
                                className="text-[9px] font-mono text-[#4a6a8a] hover:text-[#7a9ac2] transition-none"
                              >
                                {expandedId === entry.id ? "▾ transcript" : "▸ transcript"}
                              </button>
                              {expandedId === entry.id && (
                                <p className="mt-1 text-[10px] font-mono text-[#7a9ac2] leading-relaxed max-h-24 overflow-y-auto whitespace-pre-wrap">
                                  {entry.transcriptText}
                                </p>
                              )}
                            </div>
                          )}

                          {/* Restore */}
                          <button
                            onClick={() => onRestoreHistory(entry)}
                            className="mt-2 text-left text-[10px] font-mono text-[#4a6a8a] hover:text-[#00b4ff] transition-none"
                          >
                            Restaurer →
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
                className="flex items-center gap-1.5 px-2 py-1 border border-[#1a2942] hover:border-[#2a4a75] transition-none"
                style={{ borderRadius: "2px" }}
                title={displayName}
              >
                {avatarUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={avatarUrl} alt="" className="w-5 h-5 rounded-full" />
                ) : (
                  <span className="w-5 h-5 rounded-full bg-[#1a2942] flex items-center justify-center text-[9px] font-mono text-[#7a9ac2]">
                    {displayName.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="hidden sm:inline text-[11px] font-mono text-[#7a9ac2] max-w-[80px] truncate">
                  {displayName.split(" ")[0]}
                </span>
              </button>

              {showUserMenu && (
                <div
                  className="absolute right-0 top-9 w-44 bg-[#0d1420] border border-[#1a2942] shadow-xl z-50 overflow-hidden"
                  style={{ borderRadius: "4px" }}
                >
                  <div className="h-[2px] w-full" style={{ background: "linear-gradient(90deg, #00b4ff, #ff3cac)" }} />
                  <div className="px-3 py-2 border-b border-[#1a2942]">
                    <p className="text-[11px] font-mono text-[#e0eef8] truncate">{displayName}</p>
                    <p className="text-[10px] font-mono text-[#4a6a8a] truncate">{user.email}</p>
                  </div>
                  <button
                    onClick={() => { setShowUserMenu(false); onLogout(); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-mono text-[#4a6a8a] hover:text-[#ff4466] hover:bg-[#13233a] transition-none"
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
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono text-[#4a6a8a] border border-[#1a2942] hover:border-[#00b4ff] hover:text-[#00b4ff] transition-none"
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
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono text-[#4a6a8a] hover:text-[#e0eef8] transition-none"
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

