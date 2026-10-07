"use client";

import { useEffect, useRef } from "react";
import { Command } from "cmdk";
import { Link, RefreshCw, Languages, Copy, RotateCcw, X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  onPasteUrl: () => void;
  onGenerateFR: () => void;
  onGenerateEN: () => void;
  onGenerateDE: () => void;
  onGenerateES: () => void;
  onGenerateAll: () => void;
  onCopyAllQR: () => void;
  onReset: () => void;
  hasContent: boolean;
};

type Item = {
  value: string;
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
  action: () => void;
  disabled?: boolean;
};

export function CommandPalette({
  open, onClose,
  onPasteUrl,
  onGenerateFR, onGenerateEN, onGenerateDE, onGenerateES,
  onGenerateAll, onCopyAllQR, onReset,
  hasContent,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const items: Item[] = [
    {
      value: "paste-url",
      label: "Coller une URL",
      shortcut: "⌘V",
      icon: <Link size={16} />,
      action: () => { onPasteUrl(); onClose(); },
    },
    {
      value: "generate-fr",
      label: "Générer FR",
      shortcut: "GF",
      icon: <Languages size={16} />,
      action: () => { onGenerateFR(); onClose(); },
      disabled: !hasContent,
    },
    {
      value: "generate-en",
      label: "Générer EN",
      shortcut: "GE",
      icon: <Languages size={16} />,
      action: () => { onGenerateEN(); onClose(); },
      disabled: !hasContent,
    },
    {
      value: "generate-de",
      label: "Générer DE",
      shortcut: "GD",
      icon: <Languages size={16} />,
      action: () => { onGenerateDE(); onClose(); },
      disabled: !hasContent,
    },
    {
      value: "generate-es",
      label: "Générer ES",
      shortcut: "GS",
      icon: <Languages size={16} />,
      action: () => { onGenerateES(); onClose(); },
      disabled: !hasContent,
    },
    {
      value: "generate-all",
      label: "Générer les 4 langues",
      shortcut: "GA",
      icon: <RefreshCw size={16} />,
      action: () => { onGenerateAll(); onClose(); },
      disabled: !hasContent,
    },
    {
      value: "copy-qr",
      label: "Tout copier (QR)",
      shortcut: "⌘⇧C",
      icon: <Copy size={16} />,
      action: () => { onCopyAllQR(); onClose(); },
      disabled: !hasContent,
    },
    {
      value: "reset",
      label: "Nouvelle vidéo",
      icon: <RotateCcw size={16} />,
      action: () => { onReset(); onClose(); },
    },
  ];

  return (
    <>
      <div className="fixed inset-0 z-50 bg-ink/70 backdrop-blur-sm" onClick={onClose} />

      <div className="fixed top-[16vh] left-1/2 -translate-x-1/2 z-50 w-[calc(100%-24px)] max-w-lg">
        <Command className="rounded-[22px] bg-deck border border-line shadow-[0_40px_90px_-20px_rgba(0,0,0,0.8)] overflow-hidden dav-rise">
          <div className="flex items-center px-5 gap-3 border-b border-line-soft">
            <Command.Input
              ref={inputRef}
              placeholder="Rechercher une action"
              className="flex-1 h-14 bg-transparent text-[16px] text-fg placeholder:text-dim outline-none"
            />
            <button onClick={onClose} className="shrink-0 w-8 h-8 rounded-lg grid place-items-center text-dim hover:text-fg hover:bg-raised transition-colors" aria-label="Fermer">
              <X size={15} />
            </button>
          </div>

          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="py-8 text-center text-[14px] text-dim">
              Aucune action trouvée
            </Command.Empty>

            {items.map((item) => (
              <Command.Item
                key={item.value}
                value={item.value}
                keywords={[item.label]}
                disabled={item.disabled}
                onSelect={item.disabled ? undefined : item.action}
                className="flex items-center justify-between px-3 h-11 rounded-xl cursor-pointer text-muted data-[selected=true]:bg-raised data-[selected=true]:text-fg aria-disabled:opacity-40 aria-disabled:cursor-default transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-dim">{item.icon}</span>
                  <span className="text-[15px]">{item.label}</span>
                </div>
                {item.shortcut && (
                  <span className="text-[12px] font-medium text-dim bg-ink/60 px-2 h-6 rounded-md grid place-items-center">
                    {item.shortcut}
                  </span>
                )}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </div>
    </>
  );
}
