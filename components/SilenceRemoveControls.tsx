"use client";

import { Scissors, Settings, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const SILENCE_SETTINGS_KEY = "dav_silence_settings";

export type SilenceSettings = {
  thresholdDb: number;
  minSilenceMs: number;
  keepSilenceMs: number;
};

const SILENCE_DEFAULTS: SilenceSettings = {
  thresholdDb: -30,
  minSilenceMs: 500,
  keepSilenceMs: 200,
};

function loadSilenceSettings(): SilenceSettings {
  if (typeof window === "undefined") return SILENCE_DEFAULTS;
  try {
    const raw = localStorage.getItem(SILENCE_SETTINGS_KEY);
    if (raw) return { ...SILENCE_DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return SILENCE_DEFAULTS;
}

function saveSilenceSettings(s: SilenceSettings) {
  try { localStorage.setItem(SILENCE_SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; before: number; after: number };

type Props = {
  audioUrl: string;
  filename?: string;
  onReplace: (url: string, filename: string) => void;
};

export function SilenceRemoveControls({ audioUrl, filename, onReplace }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<SilenceSettings>(SILENCE_DEFAULTS);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSettings(loadSilenceSettings());
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    }
    if (showSettings) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSettings]);

  function updateSetting<K extends keyof SilenceSettings>(key: K, value: SilenceSettings[K]) {
    setSettings((s) => {
      const next = { ...s, [key]: value };
      saveSilenceSettings(next);
      return next;
    });
  }

  async function handleRemoveSilence() {
    setStatus({ kind: "loading" });
    try {
      const blob = await fetch(audioUrl).then((r) => r.blob());
      const form = new FormData();
      form.append("audio", blob, "audio.mp3");
      const params = new URLSearchParams({
        threshold_db: String(settings.thresholdDb),
        min_silence_ms: String(settings.minSilenceMs),
        keep_silence_ms: String(settings.keepSilenceMs),
      });
      const res = await fetch(`/api/audio/remove-silence?${params}`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setStatus({ kind: "error", message: err.error ?? "Erreur" });
        return;
      }
      const before = parseFloat(res.headers.get("X-Duration-Before") ?? "0");
      const after = parseFloat(res.headers.get("X-Duration-After") ?? "0");
      const outBlob = await res.blob();
      const newUrl = URL.createObjectURL(outBlob);
      const base = filename ?? "audio.mp3";
      const newFilename = base.includes(".")
        ? base.replace(/\.([^.]+)$/, "_nosilence.$1")
        : `${base}_nosilence`;
      onReplace(newUrl, newFilename);
      setStatus({ kind: "done", before, after });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const isLoading = status.kind === "loading";

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={handleRemoveSilence}
        disabled={isLoading}
        title="Enlever les silences"
        className="shrink-0 w-10 h-10 rounded-xl grid place-items-center text-muted hover:text-fg hover:bg-raised disabled:opacity-50 transition-colors"
      >
        {isLoading ? <Loader2 size={17} className="animate-spin" /> : <Scissors size={17} />}
      </button>

      <div className="relative" ref={settingsRef}>
        <button
          onClick={() => setShowSettings((v) => !v)}
          title="Réglages des silences"
          className={`shrink-0 w-8 h-10 rounded-xl grid place-items-center transition-colors ${showSettings ? "text-fg bg-raised" : "text-dim hover:text-fg hover:bg-raised"}`}
        >
          <Settings size={15} />
        </button>

        {showSettings && (
          <div className="absolute right-0 bottom-[calc(100%+8px)] z-[70] w-64 rounded-2xl bg-deck border border-line shadow-[0_28px_70px_-16px_rgba(0,0,0,0.75)] overflow-hidden dav-rise">
            <div className="flex items-center justify-between px-4 h-12 border-b border-line-soft">
              <span className="text-[15px] font-semibold text-fg">Réglages des silences</span>
              <button
                onClick={() => setShowSettings(false)}
                className="w-7 h-7 rounded-lg grid place-items-center text-dim hover:text-fg hover:bg-raised transition-colors"
                aria-label="Fermer"
              >
                <X size={14} />
              </button>
            </div>
            <div className="px-4 py-4 space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[13px] text-muted">
                  <span>Seuil</span>
                  <span className="tabular-nums text-fg">{settings.thresholdDb} dB</span>
                </div>
                <input
                  type="range"
                  min={-60}
                  max={-10}
                  step={1}
                  value={settings.thresholdDb}
                  onChange={(e) => updateSetting("thresholdDb", parseInt(e.target.value, 10))}
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[13px] text-muted">
                  <span>Silence minimum</span>
                  <span className="tabular-nums text-fg">{settings.minSilenceMs} ms</span>
                </div>
                <input
                  type="range"
                  min={200}
                  max={2000}
                  step={50}
                  value={settings.minSilenceMs}
                  onChange={(e) => updateSetting("minSilenceMs", parseInt(e.target.value, 10))}
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[13px] text-muted">
                  <span>Silence gardé</span>
                  <span className="tabular-nums text-fg">{settings.keepSilenceMs} ms</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={500}
                  step={25}
                  value={settings.keepSilenceMs}
                  onChange={(e) => updateSetting("keepSilenceMs", parseInt(e.target.value, 10))}
                  className="w-full"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {status.kind === "done" && (
        <span
          title={`Silences enlevés : ${status.before.toFixed(1)} s, puis ${status.after.toFixed(1)} s`}
          className="text-[13px] font-medium text-ok whitespace-nowrap tabular-nums"
        >
          −{(status.before - status.after).toFixed(1)} s
        </span>
      )}
      {status.kind === "error" && (
        <span className="text-[13px] font-medium text-bad whitespace-nowrap" title={status.message}>
          Échec
        </span>
      )}
    </div>
  );
}
