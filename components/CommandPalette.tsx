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
      icon: <Link size={13} />,
      action: () => { onPasteUrl(); onClose(); },
    },
    {
      value: "generate-fr",
      label: "Générer FR",
      shortcut: "GF",
      icon: <Languages size={13} />,
      action: () => { onGenerateFR(); onClose(); },
      disabled: !hasContent,
    },
    {
      value: "generate-en",
      label: "Générer EN",
      shortcut: "GE",
      icon: <Languages size={13} />,
      action: () => { onGenerateEN(); onClose(); },
      disabled: !hasContent,
    },
    {
      value: "generate-de",
      label: "Générer DE",
      shortcut: "GD",
      icon: <Languages size={13} />,
      action: () => { onGenerateDE(); onClose(); },
      disabled: !hasContent,
    },
    {
      value: "generate-es",
      label: "Générer ES",
      shortcut: "GS",
      icon: <Languages size={13} />,
      action: () => { onGenerateES(); onClose(); },
      disabled: !hasContent,
    },
    {
      value: "generate-all",
      label: "Générer les 4 langues",
      shortcut: "GA",
      icon: <RefreshCw size={13} />,
      action: () => { onGenerateAll(); onClose(); },
      disabled: !hasContent,
    },
    {
      value: "copy-qr",
      label: "Tout copier (QR)",
      shortcut: "⌘⇧C",
      icon: <Copy size={13} />,
      action: () => { onCopyAllQR(); onClose(); },
      disabled: !hasContent,
    },
    {
      value: "reset",
      label: "Réinitialiser",
      icon: <RotateCcw size={13} />,
      action: () => { onReset(); onClose(); },
    },
  ];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/75" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-[20vh] left-1/2 -translate-x-1/2 z-50 w-full max-w-md" style={{ borderRadius: "4px" }}>
        <Command
          className="bg-[#0d1420] border border-[#1a2942] overflow-hidden shadow-2xl"
          style={{ borderRadius: "4px" }}
        >
          {/* Gradient top bar */}
          <div className="h-[2px] w-full" style={{ background: "linear-gradient(90deg, #00b4ff, #ff3cac)" }} />

          {/* Input */}
          <div className="flex items-center border-b border-[#1a2942] px-3 gap-2">
            <span className="text-[#4a6a8a] shrink-0 text-[11px] font-mono">⌘</span>
            <Command.Input
              ref={inputRef}
              placeholder="Rechercher une action…"
              className="flex-1 h-11 bg-transparent text-[13px] font-mono text-[#e0eef8] placeholder-[#4a6a8a] outline-none"
            />
            <button onClick={onClose} className="shrink-0 text-[#4a6a8a] hover:text-[#e0eef8] transition-none">
              <X size={13} />
            </button>
          </div>

          <Command.List className="max-h-72 overflow-y-auto py-1">
            <Command.Empty className="py-6 text-center text-[12px] font-mono text-[#4a6a8a]">
              Aucune action trouvée
            </Command.Empty>

            {items.map((item) => (
              <Command.Item
                key={item.value}
                value={item.value}
                disabled={item.disabled}
                onSelect={item.disabled ? undefined : item.action}
                className="flex items-center justify-between px-3 py-2.5 cursor-pointer text-[#7a9ac2] data-[selected=true]:bg-[#13233a] data-[selected=true]:text-[#e0eef8] aria-disabled:opacity-40 aria-disabled:cursor-default transition-none"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-[#4a6a8a]">{item.icon}</span>
                  <span className="text-[13px] font-mono">{item.label}</span>
                </div>
                {item.shortcut && (
                  <span
                    className="text-[10px] font-mono text-[#4a6a8a] border border-[#1a2942] px-1.5 py-0.5"
                    style={{ borderRadius: "2px" }}
                  >
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
