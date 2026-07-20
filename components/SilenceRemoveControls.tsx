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
        title="Enlever silences"
        className="shrink-0 w-9 h-9 flex items-center justify-center border border-[#1a2e25] text-[#4a6a58] hover:border-[#00e5a0] hover:text-[#00e5a0] disabled:opacity-50 transition-none"
        style={{ borderRadius: "2px" }}
      >
        {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
      </button>

      <div className="relative" ref={settingsRef}>
        <button
          onClick={() => setShowSettings((v) => !v)}
          title="Réglages silence"
          className="shrink-0 w-6 h-6 flex items-center justify-center text-[#4a6a58] hover:text-[#00e5a0] transition-none"
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
        >
          <Settings size={12} />
        </button>

        {showSettings && (
          <div
            className="absolute right-0 top-full mt-1.5 z-[70] w-56 bg-[#0d1512] border border-[#1a2e25] shadow-2xl overflow-hidden"
            style={{ borderRadius: "4px" }}
          >
            <div className="h-[2px] w-full" style={{ background: "linear-gradient(90deg, #00e5a0, #ff3cac)" }} />
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a2e25]">
              <span className="text-[10px] font-mono font-semibold text-[#8aaa98] tracking-widest uppercase">
                Réglages silence
              </span>
              <button
                onClick={() => setShowSettings(false)}
                className="text-[#4a6a58] hover:text-[#e0f0e8] transition-none"
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
              >
                <X size={12} />
              </button>
            </div>
            <div className="px-3 py-3 space-y-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono text-[#8aaa98]">
                  <span>Seuil</span>
                  <span>{settings.thresholdDb} dB</span>
                </div>
                <input
                  type="range"
                  min={-60}
                  max={-10}
                  step={1}
                  value={settings.thresholdDb}
                  onChange={(e) => updateSetting("thresholdDb", parseInt(e.target.value, 10))}
                  className="w-full h-0.5 bg-[#1a2e25] cursor-pointer"
                  style={{ accentColor: "#00e5a0" }}
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono text-[#8aaa98]">
                  <span>Silence min.</span>
                  <span>{settings.minSilenceMs} ms</span>
                </div>
                <input
                  type="range"
                  min={200}
                  max={2000}
                  step={50}
                  value={settings.minSilenceMs}
                  onChange={(e) => updateSetting("minSilenceMs", parseInt(e.target.value, 10))}
                  className="w-full h-0.5 bg-[#1a2e25] cursor-pointer"
                  style={{ accentColor: "#00e5a0" }}
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono text-[#8aaa98]">
                  <span>Garder</span>
                  <span>{settings.keepSilenceMs} ms</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={500}
                  step={25}
                  value={settings.keepSilenceMs}
                  onChange={(e) => updateSetting("keepSilenceMs", parseInt(e.target.value, 10))}
                  className="w-full h-0.5 bg-[#1a2e25] cursor-pointer"
                  style={{ accentColor: "#00e5a0" }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {status.kind === "done" && (
        <span
          title={`Silence removed: ${status.before.toFixed(1)}s → ${status.after.toFixed(1)}s (saved ${(status.before - status.after).toFixed(1)}s)`}
          className="text-[10px] font-mono text-[#00e5a0] whitespace-nowrap"
        >
          −{(status.before - status.after).toFixed(1)}s
        </span>
      )}
      {status.kind === "error" && (
        <span className="text-[10px] font-mono text-[#ff4466] whitespace-nowrap" title={status.message}>
          Erreur
        </span>
      )}
    </div>
  );
}
