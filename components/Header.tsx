"use client";

import { Clock, RotateCcw, Command } from "lucide-react";
import type { HistoryEntry } from "../types";
import { formatDate } from "../lib/format";

const APP_VERSION = "2.1";

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
};

export function Header({
  history, showHistory, onToggleHistory, onRestoreHistory,
  onDeleteHistory, onClearHistory, canReset, onReset, onOpenPalette,
  historyPanelRef,
}: Props) {
  return (
    <header className="sticky top-0 z-40 border-b border-[#44423D]" style={{ background: "rgba(38,38,36,0.85)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
      <div className="max-w-5xl mx-auto px-4 h-12 flex items-center justify-between gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-mono font-semibold tracking-tight text-[#F0EEE6]">
            DAV PIPELINE
          </span>
          <span className="text-[10px] font-mono text-[#7D7A72] border border-[#44423D] px-1.5 py-0.5" style={{ borderRadius: "4px" }}>
            v{APP_VERSION}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Command palette trigger */}
          <button
            onClick={onOpenPalette}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono text-[#7D7A72] border border-[#44423D] hover:border-[#5C5851] hover:text-[#F0EEE6] transition-none"
            style={{ borderRadius: "4px" }}
            title="⌘K — Command palette"
          >
            <Command size={11} />
            <span className="hidden sm:inline">⌘K</span>
          </button>

          {/* History */}
          <div className="relative" ref={historyPanelRef}>
            <button
              onClick={onToggleHistory}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono text-[#7D7A72] border border-[#44423D] hover:border-[#5C5851] hover:text-[#F0EEE6] transition-none"
              style={{ borderRadius: "4px" }}
            >
              <Clock size={11} />
              <span className="hidden sm:inline">Historique</span>
              {history.length > 0 && (
                <span className="bg-[#44423D] text-[#B0ADA3] px-1 text-[9px] font-mono" style={{ borderRadius: "3px" }}>
                  {history.length}
                </span>
              )}
            </button>

            {showHistory && (
              <div className="absolute right-0 top-9 w-80 bg-[#2F2F2C] border border-[#44423D] shadow-2xl z-50 overflow-hidden" style={{ borderRadius: "8px" }}>
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#44423D]">
                  <span className="text-[10px] font-mono font-semibold text-[#B0ADA3] tracking-widest uppercase">Historique</span>
                  {history.length > 0 && (
                    <button
                      onClick={onClearHistory}
                      className="text-[10px] font-mono text-[#7D7A72] hover:text-[#EF4444] transition-none"
                    >
                      Tout effacer
                    </button>
                  )}
                </div>
                {history.length === 0 ? (
                  <div className="px-4 py-8 text-center text-[11px] font-mono text-[#7D7A72]">
                    Aucune vidéo générée
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto divide-y divide-[#44423D]">
                    {history.map((entry) => (
                      <div
                        key={entry.id}
                        onClick={() => onRestoreHistory(entry)}
                        className="group flex items-start gap-2 px-4 py-2.5 hover:bg-[#3A3A36] cursor-pointer transition-none"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] text-[#F0EEE6] truncate font-medium leading-snug">
                            {entry.title || "Sans titre"}
                          </p>
                          <p className="text-[10px] text-[#7D7A72] font-mono mt-0.5">
                            {formatDate(entry.date)} · {entry.provider}
                          </p>
                        </div>
                        <button
                          onClick={(e) => onDeleteHistory(entry.id, e)}
                          className="opacity-0 group-hover:opacity-100 text-[#7D7A72] hover:text-[#EF4444] transition-none shrink-0 mt-0.5"
                        >
                          <span className="text-xs">×</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Reset */}
          {canReset && (
            <button
              onClick={onReset}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono text-[#7D7A72] hover:text-[#F0EEE6] transition-none"
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
