"use client";

import { useState, useEffect, useRef } from "react";
import { EDGE_TTS_VOICES } from "../lib/edge-tts-voices";

const APP_VERSION = "2.0";

const SECTIONS = [
  "SCRIPT FR",
  "SCRIPT EN",
  "SCRIPT DE",
  "SEARCH KEYWORDS EN",
  "TITRE ET HASHTAGS FR",
  "TITRE ET HASHTAGS EN",
  "TITRE ET HASHTAGS DE",
] as const;

type Section = (typeof SECTIONS)[number];
type Provider = "ai33-minimax" | "ai33-elevenlabs" | "elevenlabs" | "edge-tts";
type Step = "idle" | "extracting" | "transcript" | "rewriting" | "done";
type DurationSelection = "15s" | "30s" | "60s" | "custom" | "original";
type AudioState = {
  status: "loading" | "done" | "error";
  label: string;
  audioUrl?: string;
  filename?: string;
};

type VoiceSettings = {
  speed: number;
  pitch: number;
  volume: number;
};

type HistoryEntry = {
  id: string;
  date: string;
  title: string;
  url: string;
  qrText: string;
  provider: Provider;
};

const SCRIPT_SECTIONS: Section[] = ["SCRIPT FR", "SCRIPT EN", "SCRIPT DE"];
const ADJUST_DURATIONS = ["10s", "15s", "30s", "45s", "1min", "1min30", "2min"] as const;
type AdjustDuration = (typeof ADJUST_DURATIONS)[number];

const PROVIDERS_UI: { id: Provider; label: string; group: string }[] = [
  { id: "ai33-minimax",    label: "Minimax",    group: "AI33pro" },
  { id: "ai33-elevenlabs", label: "ElevenLabs", group: "AI33pro" },
  { id: "elevenlabs",      label: "ElevenLabs", group: "Direct"  },
  { id: "edge-tts",        label: "Edge TTS",   group: "Gratuit" },
];

type EdgeLang = keyof typeof EDGE_TTS_VOICES;
const EDGE_LANG_LABELS: Record<EdgeLang, string> = { fr: "Français", en: "English", de: "Deutsch" };

const HISTORY_KEY = "qr_pipeline_history";
const MAX_HISTORY = 50;

const DURATION_PILLS: { value: DurationSelection; label: string }[] = [
  { value: "15s",      label: "15s" },
  { value: "30s",      label: "30s" },
  { value: "60s",      label: "60s" },
  { value: "original", label: "Durée originale" },
  { value: "custom",   label: "Personnalisé" },
];

function sanitizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function wordStats(text: string): { words: number; duration: string } {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const totalSec = Math.round((words * 60) / 130);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const duration =
    min === 0
      ? `${totalSec}sec`
      : sec === 0
      ? `${min}min`
      : `${min}min${String(sec).padStart(2, "0")}sec`;
  return { words, duration };
}

function cleanContent(raw: string): string {
  return raw
    .replace(/\n*SECTION\s+\d+\s*$/i, "")
    .replace(/\n*Prêt pour le prochain script\s*!?\s*$/i, "")
    .trim();
}

function parseQR(text: string): Partial<Record<Section, string>> {
  const positions: Array<{ section: Section; index: number }> = [];
  for (const section of SECTIONS) {
    const idx = text.indexOf(section);
    if (idx !== -1) positions.push({ section, index: idx });
  }
  positions.sort((a, b) => a.index - b.index);

  const result: Partial<Record<Section, string>> = {};
  for (let i = 0; i < positions.length; i++) {
    const { section, index } = positions[i];
    const start = index + section.length;
    const end = i + 1 < positions.length ? positions[i + 1].index : text.length;
    const content = cleanContent(text.slice(start, end).trim());
    if (content) result[section] = content;
  }
  return result;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Slider Component ──────────────────────────────────────────────────────────
function Slider({
  label, value, min, max, step, format, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <span className="text-xs text-neutral-500 font-mono w-16 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1 appearance-none bg-neutral-700 rounded-full accent-white cursor-pointer"
      />
      <span className="text-xs text-neutral-300 font-mono w-10 text-right shrink-0">
        {format(value)}
      </span>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Home() {
  const [url, setUrl] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [videoTitle, setVideoTitle] = useState("");
  const [qrText, setQrText] = useState("");
  const [error, setError] = useState("");
  const [provider, setProvider] = useState<Provider>("ai33-minimax");
  const [audio, setAudio] = useState<Record<string, AudioState>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Partial<Record<Section, string>>>({});
  const [adjusting, setAdjusting] = useState<Section | null>(null);
  const [transcriptText, setTranscriptText] = useState("");
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState<DurationSelection>("original");
  const [customSeconds, setCustomSeconds] = useState(30);

  // ── Voice settings ────────────────────────────────────────────────────────
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({
    speed: 1.0,
    pitch: 0,
    volume: 1.0,
  });
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);

  // ── Edge TTS settings ─────────────────────────────────────────────────────
  const [edgeVoiceFr, setEdgeVoiceFr] = useState("fr-FR-HenriNeural");
  const [edgeVoiceEn, setEdgeVoiceEn] = useState("en-US-GuyNeural");
  const [edgeVoiceDe, setEdgeVoiceDe] = useState("de-DE-KillianNeural");
  const [edgeRate, setEdgeRate] = useState(0);

  // ── History ───────────────────────────────────────────────────────────────
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const historyPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (historyPanelRef.current && !historyPanelRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    }
    if (showHistory) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showHistory]);

  function saveToHistory(title: string, currentUrl: string, text: string) {
    const entry: HistoryEntry = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      title,
      url: currentUrl,
      qrText: text,
      provider,
    };
    setHistory((prev) => {
      const updated = [entry, ...prev].slice(0, MAX_HISTORY);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }

  function restoreFromHistory(entry: HistoryEntry) {
    reset();
    setTimeout(() => {
      setVideoTitle(entry.title);
      setUrl(entry.url);
      setQrText(entry.qrText);
      setProvider(entry.provider);
      setStep("done");
      setShowHistory(false);
    }, 50);
  }

  function deleteHistoryEntry(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setHistory((prev) => {
      const updated = prev.filter((h) => h.id !== id);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }

  function clearHistory() {
    setHistory([]);
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
  }

  // ──────────────────────────────────────────────────────────────────────────

  const sections = step === "done" ? parseQR(qrText) : {};
  const isLoading = step === "extracting" || step === "rewriting";

  function getContent(section: Section): string | undefined {
    return overrides[section] ?? sections[section];
  }

  function reset() {
    setUrl("");
    setStep("idle");
    setVideoTitle("");
    setQrText("");
    setError("");
    setAudio({});
    setCopied(null);
    setOverrides({});
    setAdjusting(null);
    setTranscriptText("");
    setCopiedTranscript(false);
    setCopiedAll(false);
    setSelectedDuration("original");
    setCustomSeconds(30);
  }

  async function handleExtract() {
    if (!url || isLoading) return;
    setError("");
    setQrText("");
    setStep("extracting");

    const res = await fetch("/api/transcript", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Erreur extraction");
      setStep("idle");
      return;
    }

    setVideoTitle(data.title);
    setTranscriptText(data.text);
    setStep("transcript");
  }

  function computeTargetSeconds(): number | "original" {
    if (selectedDuration === "original") return "original";
    if (selectedDuration === "custom") return Math.min(180, Math.max(5, customSeconds));
    if (selectedDuration === "15s") return 15;
    if (selectedDuration === "30s") return 30;
    if (selectedDuration === "60s") return 60;
    return "original";
  }

  async function handleGenerateQR() {
    if (!transcriptText) return;
    setError("");
    await handleRewrite(transcriptText, videoTitle, computeTargetSeconds());
  }

  async function handleRewrite(text: string, title?: string, targetSeconds: number | "original" = "original") {
    setStep("rewriting");

    const res = await fetch("/api/rewrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, targetSeconds }),
    });

    if (!res.ok || !res.body) {
      setError("Erreur réécriture");
      setStep("transcript");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulated += decoder.decode(value, { stream: true });
      setQrText(accumulated);
    }
    setStep("done");

    const finalTitle = title ?? videoTitle;
    if (finalTitle) saveToHistory(finalTitle, url, accumulated);
  }

  async function handleTTS(language: "EN" | "DE") {
    const sectionKey = `SCRIPT ${language}` as Section;
    const text = getContent(sectionKey);
    if (!text) return;

    const filename = `${sanitizeTitle(videoTitle)}_${language}.mp3`;
    setAudio((a) => ({ ...a, [language]: { status: "loading", label: "Envoi..." } }));

    if (provider === "elevenlabs") {
      try {
        const res = await fetch("/api/tts/elevenlabs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, speed: voiceSettings.speed, pitch: voiceSettings.pitch, volume: voiceSettings.volume }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          setAudio((a) => ({ ...a, [language]: { status: "error", label: err.error ?? "Erreur ElevenLabs" } }));
          return;
        }
        const blob = await res.blob();
        const audioUrl = URL.createObjectURL(blob);
        setAudio((s) => ({ ...s, [language]: { status: "done", label: "Prêt", audioUrl, filename } }));
      } catch (err) {
        setAudio((a) => ({ ...a, [language]: { status: "error", label: String(err) } }));
      }
      return;
    }

    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text, language, provider, title: videoTitle,
        speed: voiceSettings.speed, pitch: voiceSettings.pitch, volume: voiceSettings.volume,
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      setAudio((a) => ({ ...a, [language]: { status: "error", label: data.error ?? "Erreur" } }));
      return;
    }

    const { taskId, apiKey } = data;
    if (!taskId) {
      setAudio((a) => ({ ...a, [language]: { status: "error", label: "Pas de taskId" } }));
      return;
    }

    for (let i = 0; i < 360; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const elapsed = (i + 1) * 5;
      const label =
        elapsed < 60
          ? `Génération... ${elapsed}s`
          : `Génération... ${Math.floor(elapsed / 60)}min${elapsed % 60 > 0 ? `${elapsed % 60}s` : ""}`;
      setAudio((a) => ({ ...a, [language]: { status: "loading", label } }));

      try {
        const poll = await fetch(`https://api.ai33.pro/v1/task/${taskId}`, {
          headers: { "xi-api-key": apiKey },
        });
        const pollData = await poll.json();
        if (pollData.status === "done" && pollData.audio_url) {
          setAudio((s) => ({
            ...s,
            [language]: { status: "done", label: "Prêt", audioUrl: pollData.audio_url, filename },
          }));
          return;
        }
      } catch {}
    }
    setAudio((a) => ({ ...a, [language]: { status: "error", label: "Timeout (30 min)" } }));
  }

  async function handleEdgeTTSLang(lang: "FR" | "EN" | "DE", voice: string) {
    const sectionKey = `SCRIPT ${lang}` as Section;
    const text = getContent(sectionKey);
    if (!text) return;

    const filename = `${sanitizeTitle(videoTitle)}_${lang}_edge.mp3`;
    const rateStr = edgeRate >= 0 ? `+${edgeRate}%` : `${edgeRate}%`;

    setAudio((a) => ({ ...a, [`EDGE_${lang}`]: { status: "loading", label: "Génération..." } }));

    try {
      const res = await fetch("/api/tts-edge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice, rate: rateStr }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setAudio((a) => ({ ...a, [`EDGE_${lang}`]: { status: "error", label: err.error ?? "Erreur Edge TTS" } }));
        return;
      }
      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      setAudio((s) => ({ ...s, [`EDGE_${lang}`]: { status: "done", label: "Prêt", audioUrl, filename } }));
    } catch (err) {
      setAudio((a) => ({ ...a, [`EDGE_${lang}`]: { status: "error", label: String(err) } }));
    }
  }

  async function handleEdgeTTSAll() {
    await Promise.all([
      handleEdgeTTSLang("FR", edgeVoiceFr),
      handleEdgeTTSLang("EN", edgeVoiceEn),
      handleEdgeTTSLang("DE", edgeVoiceDe),
    ]);
  }

  async function handleAdjust(section: Section, targetDuration: AdjustDuration) {
    const text = getContent(section);
    if (!text || adjusting) return;

    const language = section.split(" ")[1];
    setAdjusting(section);
    setOverrides((o) => ({ ...o, [section]: "" }));

    const res = await fetch("/api/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language, targetDuration }),
    });

    if (!res.ok || !res.body) {
      setAdjusting(null);
      setOverrides((o) => { const n = { ...o }; delete n[section]; return n; });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulated += decoder.decode(value, { stream: true });
      setOverrides((o) => ({ ...o, [section]: accumulated }));
    }
    setAdjusting(null);
  }

  function restoreOriginal(section: Section) {
    setOverrides((o) => { const n = { ...o }; delete n[section]; return n; });
  }

  async function copySection(key: string, text: string) {
    await navigator.clipboard.writeText(`${key}\n\n${text}`);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  async function copyAllQR() {
    const parts = SECTIONS.map((section) => {
      const content = getContent(section) ?? "";
      return `=== ${section} ===\n${content}`;
    });
    await navigator.clipboard.writeText(parts.join("\n\n"));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-start">
          <div className="flex-1" />
          <div className="text-center">
            <h1 className="text-3xl font-mono font-bold tracking-tighter text-neutral-100">
              DAV PIPELINE
              <span className="text-neutral-600 font-normal text-base ml-2">v{APP_VERSION}</span>
            </h1>
            <p className="text-neutral-400 text-xs font-mono tracking-widest uppercase mt-1">
              Made by Dav
            </p>
          </div>
          <div className="flex-1 flex justify-end items-start gap-3">
            {/* History button */}
            <div className="relative" ref={historyPanelRef}>
              <button
                onClick={() => setShowHistory((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-200 transition-colors border border-neutral-800 hover:border-neutral-600 rounded-md px-2.5 py-1.5"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                Historique
                {history.length > 0 && (
                  <span className="bg-neutral-700 text-neutral-300 rounded px-1 text-[10px] font-mono">
                    {history.length}
                  </span>
                )}
              </button>

              {/* History panel */}
              {showHistory && (
                <div className="absolute right-0 top-9 w-80 bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
                    <span className="text-xs font-mono font-bold text-neutral-300 tracking-widest">HISTORIQUE</span>
                    {history.length > 0 && (
                      <button
                        onClick={clearHistory}
                        className="text-[10px] text-neutral-600 hover:text-red-400 transition-colors font-mono"
                      >
                        Tout effacer
                      </button>
                    )}
                  </div>

                  {history.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs text-neutral-600 font-mono">
                      Aucune vidéo générée
                    </div>
                  ) : (
                    <div className="max-h-96 overflow-y-auto divide-y divide-neutral-800/50">
                      {history.map((entry) => (
                        <div
                          key={entry.id}
                          onClick={() => restoreFromHistory(entry)}
                          className="group flex items-start gap-2 px-4 py-3 hover:bg-neutral-800/50 cursor-pointer transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-neutral-200 truncate font-medium leading-snug">
                              {entry.title || "Sans titre"}
                            </p>
                            <p className="text-[10px] text-neutral-600 font-mono mt-0.5">
                              {formatDate(entry.date)} · {entry.provider}
                            </p>
                          </div>
                          <button
                            onClick={(e) => deleteHistoryEntry(entry.id, e)}
                            className="opacity-0 group-hover:opacity-100 text-neutral-600 hover:text-red-400 transition-all shrink-0 mt-0.5"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {(step === "transcript" || step === "done") && (
              <button
                onClick={reset}
                className="text-xs text-neutral-500 hover:text-neutral-200 transition-colors"
              >
                Réinitialiser
              </button>
            )}
          </div>
        </div>

        {/* Video title */}
        {videoTitle && (
          <p className="text-sm text-neutral-400 truncate">
            <span className="text-neutral-600">Vidéo : </span>
            {videoTitle}
          </p>
        )}

        {/* Transcript — visible from "transcript" step onwards */}
        {transcriptText && step !== "idle" && step !== "extracting" && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800">
              <span className="text-xs font-mono font-bold text-neutral-400 tracking-widest">
                📜 TRANSCRIPT ORIGINAL
              </span>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(transcriptText);
                  setCopiedTranscript(true);
                  setTimeout(() => setCopiedTranscript(false), 1500);
                }}
                className="text-xs text-neutral-500 hover:text-neutral-200 transition-colors"
              >
                {copiedTranscript ? "Copié !" : "📋 Copier"}
              </button>
            </div>
            <p className="px-4 py-3 text-sm text-neutral-400 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
              {transcriptText}
            </p>
          </div>
        )}

        {/* Step: idle — URL input */}
        {step === "idle" && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleExtract()}
                placeholder="https://youtube.com/watch?v=..."
                className="flex-1 bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-2.5 text-sm placeholder-neutral-600 focus:outline-none focus:border-neutral-600"
              />
              <button
                onClick={handleExtract}
                disabled={!url}
                className="px-5 py-2.5 bg-white text-black text-sm font-semibold rounded-lg disabled:opacity-40 hover:bg-neutral-200 transition-colors whitespace-nowrap"
              >
                Extraire le transcript
              </button>
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
          </div>
        )}

        {/* Step: extracting — spinner */}
        {step === "extracting" && (
          <div className="flex items-center gap-3 text-sm text-neutral-400">
            <span className="w-4 h-4 border-2 border-neutral-600 border-t-neutral-300 rounded-full animate-spin" />
            Extraction du transcript...
          </div>
        )}

        {/* Step: transcript — duration selector + generate */}
        {step === "transcript" && (
          <div className="space-y-5">
            <div className="space-y-3">
              <p className="text-xs font-mono text-neutral-500 tracking-widest uppercase">Durée cible</p>
              <div className="flex flex-wrap gap-2">
                {DURATION_PILLS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setSelectedDuration(value)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                      selectedDuration === value
                        ? "bg-white text-black border-white font-semibold"
                        : "border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {selectedDuration === "custom" && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={5}
                    max={180}
                    value={customSeconds}
                    onChange={(e) =>
                      setCustomSeconds(Math.min(180, Math.max(5, parseInt(e.target.value) || 5)))
                    }
                    className="w-24 bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-sm text-neutral-200 focus:outline-none focus:border-neutral-600"
                  />
                  <span className="text-xs text-neutral-500">secondes</span>
                </div>
              )}
            </div>
            <button
              onClick={handleGenerateQR}
              className="w-full py-3 bg-white text-black text-sm font-semibold rounded-lg hover:bg-neutral-200 transition-colors"
            >
              Générer le QR
            </button>
            {error && <p className="text-red-400 text-sm">{error}</p>}
          </div>
        )}

        {/* Step: rewriting — spinner then streaming */}
        {step === "rewriting" && !qrText && (
          <div className="flex items-center gap-3 text-sm text-neutral-400">
            <span className="w-4 h-4 border-2 border-neutral-600 border-t-neutral-300 rounded-full animate-spin" />
            Réécriture en cours...
          </div>
        )}
        {step === "rewriting" && qrText && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-3 h-3 border-2 border-neutral-600 border-t-neutral-300 rounded-full animate-spin" />
              <span className="text-xs text-neutral-500 font-mono">Réécriture en cours...</span>
            </div>
            <p className="text-sm text-neutral-300 whitespace-pre-wrap leading-relaxed line-clamp-8">
              {qrText}
            </p>
          </div>
        )}

        {/* Step: done */}
        {step === "done" && (
          <div className="space-y-6">

            {/* Voice controls */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                {/* Provider selector */}
                <div className="flex items-stretch bg-neutral-900 border border-neutral-800 rounded-lg p-1 text-xs gap-1">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-neutral-600 font-mono text-[10px] px-2 leading-none">AI33pro</span>
                    <div className="flex gap-1">
                      {PROVIDERS_UI.filter((p) => p.group === "AI33pro").map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setProvider(p.id)}
                          className={`px-3 py-1.5 rounded-md transition-colors ${
                            provider === p.id
                              ? "bg-white text-black font-semibold"
                              : "text-neutral-400 hover:text-neutral-200"
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="w-px bg-neutral-800 mx-1 self-stretch" />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-neutral-600 font-mono text-[10px] px-2 leading-none">Direct</span>
                    <div className="flex gap-1">
                      {PROVIDERS_UI.filter((p) => p.group === "Direct").map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setProvider(p.id)}
                          className={`px-3 py-1.5 rounded-md transition-colors ${
                            provider === p.id
                              ? "bg-white text-black font-semibold"
                              : "text-neutral-400 hover:text-neutral-200"
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="w-px bg-neutral-800 mx-1 self-stretch" />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-neutral-600 font-mono text-[10px] px-2 leading-none">Gratuit</span>
                    <div className="flex gap-1">
                      {PROVIDERS_UI.filter((p) => p.group === "Gratuit").map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setProvider(p.id)}
                          className={`px-3 py-1.5 rounded-md transition-colors ${
                            provider === p.id
                              ? "bg-white text-black font-semibold"
                              : "text-neutral-400 hover:text-neutral-200"
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Voice buttons */}
                {(["EN", "DE"] as const).map((lang) => {
                  const state = audio[lang];
                  const busy = state?.status === "loading";
                  return (
                    <button
                      key={lang}
                      onClick={() => handleTTS(lang)}
                      disabled={busy}
                      className="flex items-center gap-2 px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-sm rounded-lg disabled:opacity-50 transition-colors"
                    >
                      <span>Voix {lang}</span>
                      {state && (
                        <span className={`text-xs ${
                          state.status === "done" ? "text-green-400"
                          : state.status === "error" ? "text-red-400"
                          : "text-neutral-400"
                        }`}>
                          {state.label}
                        </span>
                      )}
                    </button>
                  );
                })}

                {/* Voice settings toggle */}
                <button
                  onClick={() => setShowVoiceSettings((v) => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    showVoiceSettings
                      ? "border-neutral-500 text-neutral-200 bg-neutral-800"
                      : "border-neutral-800 text-neutral-500 hover:text-neutral-300 hover:border-neutral-600"
                  }`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
                  </svg>
                  Réglages
                </button>
              </div>

              {/* Voice settings panel */}
              {showVoiceSettings && (
                <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-neutral-400 tracking-widest">RÉGLAGES VOIX</span>
                    <button
                      onClick={() => setVoiceSettings({ speed: 1.0, pitch: 0, volume: 1.0 })}
                      className="text-[10px] text-neutral-600 hover:text-neutral-400 font-mono transition-colors"
                    >
                      Réinitialiser
                    </button>
                  </div>
                  <Slider
                    label="Vitesse"
                    value={voiceSettings.speed}
                    min={0.5} max={2.0} step={0.05}
                    format={(v) => `×${v.toFixed(2)}`}
                    onChange={(v) => setVoiceSettings((s) => ({ ...s, speed: v }))}
                  />
                  <Slider
                    label="Hauteur"
                    value={voiceSettings.pitch}
                    min={-12} max={12} step={1}
                    format={(v) => (v > 0 ? `+${v}` : `${v}`)}
                    onChange={(v) => setVoiceSettings((s) => ({ ...s, pitch: v }))}
                  />
                  <Slider
                    label="Volume"
                    value={voiceSettings.volume}
                    min={0.0} max={2.0} step={0.05}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => setVoiceSettings((s) => ({ ...s, volume: v }))}
                  />
                </div>
              )}

              {/* Edge TTS panel */}
              {provider === "edge-tts" && (
                <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 space-y-4">
                  <span className="text-xs font-mono font-bold text-neutral-400 tracking-widest">EDGE TTS — Microsoft Neural</span>

                  {/* Per-language voice rows */}
                  {(
                    [
                      { lang: "FR" as const, voice: edgeVoiceFr, setVoice: setEdgeVoiceFr, voices: EDGE_TTS_VOICES.fr },
                      { lang: "EN" as const, voice: edgeVoiceEn, setVoice: setEdgeVoiceEn, voices: EDGE_TTS_VOICES.en },
                      { lang: "DE" as const, voice: edgeVoiceDe, setVoice: setEdgeVoiceDe, voices: EDGE_TTS_VOICES.de },
                    ] as const
                  ).map(({ lang, voice, setVoice, voices }) => {
                    const state = audio[`EDGE_${lang}`];
                    const busy = state?.status === "loading";
                    return (
                      <div key={lang} className="flex items-center gap-2">
                        <span className="text-xs text-neutral-500 font-mono w-6 shrink-0">{lang}</span>
                        <select
                          value={voice}
                          onChange={(e) => setVoice(e.target.value)}
                          className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-neutral-500"
                        >
                          {voices.map((v) => (
                            <option key={v.id} value={v.id}>{v.label}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleEdgeTTSLang(lang, voice)}
                          disabled={busy}
                          className={`shrink-0 px-3 py-1.5 text-xs rounded-lg font-semibold transition-colors disabled:opacity-50 ${
                            state?.status === "error"
                              ? "bg-red-900/60 hover:bg-red-900 text-red-300"
                              : state?.status === "done"
                              ? "bg-green-900/60 hover:bg-green-900 text-green-300"
                              : "bg-neutral-700 hover:bg-neutral-600 text-neutral-100"
                          }`}
                        >
                          {busy ? state.label : state?.status === "done" ? "Regénérer" : state?.status === "error" ? "Erreur" : "Générer"}
                        </button>
                      </div>
                    );
                  })}

                  {/* Shared rate slider */}
                  <Slider
                    label="Vitesse"
                    value={edgeRate}
                    min={-50} max={200} step={10}
                    format={(v) => (v >= 0 ? `+${v}%` : `${v}%`)}
                    onChange={(v) => setEdgeRate(v)}
                  />

                  {/* Generate all 3 button */}
                  <button
                    onClick={handleEdgeTTSAll}
                    disabled={
                      audio["EDGE_FR"]?.status === "loading" ||
                      audio["EDGE_EN"]?.status === "loading" ||
                      audio["EDGE_DE"]?.status === "loading"
                    }
                    className="w-full py-2 bg-neutral-700 hover:bg-neutral-600 text-sm text-neutral-100 font-semibold rounded-lg disabled:opacity-50 transition-colors"
                  >
                    Générer les 3 langues
                  </button>
                </div>
              )}
            </div>

            {/* Audio players */}
            {(["EN", "DE"] as const).map((lang) => {
              const state = audio[lang];
              if (state?.status !== "done" || !state.audioUrl) return null;
              return (
                <div key={lang} className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-neutral-400 tracking-widest">
                      VOIX {lang}
                    </span>
                    <span className="text-xs text-neutral-600 truncate max-w-xs">{state.filename}</span>
                  </div>
                  <audio controls src={state.audioUrl} className="w-full h-10" />
                  <a
                    href={state.audioUrl}
                    download={state.filename}
                    className="inline-block text-xs text-neutral-400 hover:text-neutral-100 border border-neutral-700 hover:border-neutral-500 rounded px-3 py-1.5 transition-colors"
                  >
                    Télécharger {state.filename}
                  </a>
                </div>
              );
            })}

            {/* Edge TTS audio players */}
            {(["FR", "EN", "DE"] as const).map((lang) => {
              const state = audio[`EDGE_${lang}`];
              if (state?.status !== "done" || !state.audioUrl) return null;
              return (
                <div key={`EDGE_${lang}`} className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-neutral-400 tracking-widest">
                      EDGE TTS — {lang}
                    </span>
                    <span className="text-xs text-neutral-600 truncate max-w-xs">{state.filename}</span>
                  </div>
                  <audio controls src={state.audioUrl} className="w-full h-10" />
                  <a
                    href={state.audioUrl}
                    download={state.filename}
                    className="inline-block text-xs text-neutral-400 hover:text-neutral-100 border border-neutral-700 hover:border-neutral-500 rounded px-3 py-1.5 transition-colors"
                  >
                    Télécharger {state.filename}
                  </a>
                </div>
              );
            })}

            {/* Copy all QR */}
            <div className="flex justify-end">
              <button
                onClick={copyAllQR}
                className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-200 transition-colors border border-neutral-800 hover:border-neutral-600 rounded-md px-3 py-1.5"
              >
                {copiedAll ? "Copié !" : "📋 Tout copier (QR)"}
              </button>
            </div>

            {/* 7 sections */}
            {SECTIONS.map((section) => {
              const content = getContent(section);
              if (!content && !sections[section]) return null;

              const isScript = SCRIPT_SECTIONS.includes(section);
              const isAdjusting = adjusting === section;
              const hasOverride = section in overrides;
              const displayContent = content ?? "";
              const stats = isScript && displayContent ? wordStats(displayContent) : null;

              return (
                <div
                  key={section}
                  className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden"
                >
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-neutral-400 tracking-widest">
                        {section}
                      </span>
                      {hasOverride && !isAdjusting && (
                        <button
                          onClick={() => restoreOriginal(section)}
                          className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
                        >
                          ↩ Original
                        </button>
                      )}
                      {isAdjusting && (
                        <span className="flex items-center gap-1 text-xs text-neutral-500">
                          <span className="w-2.5 h-2.5 border border-neutral-600 border-t-neutral-400 rounded-full animate-spin" />
                          Réécriture...
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => copySection(section, displayContent)}
                      className="text-xs text-neutral-500 hover:text-neutral-200 transition-colors"
                    >
                      {copied === section ? "Copié ✓" : "Copier"}
                    </button>
                  </div>

                  <p className="px-4 py-3 text-sm text-neutral-200 whitespace-pre-wrap leading-relaxed">
                    {displayContent}
                  </p>

                  {isScript && stats && (
                    <div className="flex items-center gap-3 px-4 py-2.5 border-t border-neutral-800">
                      <span className="text-xs text-neutral-500 font-mono shrink-0">
                        {stats.words} mots — {stats.duration}
                      </span>
                      <div className="flex gap-1 ml-auto flex-wrap">
                        {ADJUST_DURATIONS.map((d) => (
                          <button
                            key={d}
                            onClick={() => handleAdjust(section, d)}
                            disabled={!!adjusting}
                            className="text-xs px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200 rounded transition-colors disabled:opacity-40"
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            <p className="text-center text-neutral-700 text-xs font-mono pt-4">
              Prêt pour le prochain script !
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <p className="text-center text-neutral-600 text-xs font-mono mt-16 pb-6 opacity-60">
        DAV Pipeline · made by Dav · 2026
      </p>
    </main>
  );
}
