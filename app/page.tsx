"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { Header } from "../components/Header";
import { UrlInput } from "../components/UrlInput";
import { GenerationPanel } from "../components/GenerationPanel";
import { EDGE_TTS_VOICES } from "../lib/edge-tts-voices";
import { GOOGLE_TTS_VOICES } from "../lib/google-tts-voices";
import { sanitizeTitle, wordStats } from "../lib/format";
import type { Provider, Section, AudioState, Step, HistoryEntry } from "../types";
import { SECTIONS } from "../types";

// ── Constants ─────────────────────────────────────────────────────────────────
const SCRIPT_SECTIONS: Section[] = ["SCRIPT FR", "SCRIPT EN", "SCRIPT DE"];
const ADJUST_DURATIONS = ["10s", "15s", "30s", "45s", "1min", "1min30", "2min"] as const;
type AdjustDuration = (typeof ADJUST_DURATIONS)[number];

const HISTORY_KEY = "qr_pipeline_history";
const MAX_HISTORY = 50;

// ── Helpers ───────────────────────────────────────────────────────────────────
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
  const [targetDuration, setTargetDuration] = useState<AdjustDuration | "original">("original");

  // History
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const historyPanelRef = useRef<HTMLDivElement>(null);

  // Command palette
  const [showPalette, setShowPalette] = useState(false);

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
      title, url: currentUrl, qrText: text, provider,
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
    setTargetDuration("original");
  }

  // ── Extract ───────────────────────────────────────────────────────────────
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

  // ── Rewrite ───────────────────────────────────────────────────────────────
  function durationToSeconds(d: AdjustDuration | "original"): number | "original" {
    if (d === "original") return "original";
    if (d === "10s") return 10;
    if (d === "15s") return 15;
    if (d === "30s") return 30;
    if (d === "45s") return 45;
    if (d === "1min") return 60;
    if (d === "1min30") return 90;
    if (d === "2min") return 120;
    return "original";
  }

  async function handleRewrite(text: string, title?: string) {
    setStep("rewriting");
    const targetSeconds = durationToSeconds(targetDuration);

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

  // ── TTS ───────────────────────────────────────────────────────────────────
  async function handleTTS(language: "EN" | "DE" | "FR", voice: string, speed: number) {
    const sectionKey = `SCRIPT ${language}` as Section;
    const text = getContent(sectionKey);
    if (!text) return;

    const filename = `${sanitizeTitle(videoTitle)}_${language}.mp3`;

    if (provider === "edge-tts") {
      const audioKey = `EDGE_${language}`;
      const rateStr = speed >= 0 ? `+${speed}%` : `${speed}%`;
      setAudio((a) => ({ ...a, [audioKey]: { status: "loading", label: "Génération..." } }));
      try {
        const res = await fetch("/api/tts-edge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice, rate: rateStr }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          setAudio((a) => ({ ...a, [audioKey]: { status: "error", label: err.error ?? "Erreur Edge TTS" } }));
          return;
        }
        const blob = await res.blob();
        const audioUrl = URL.createObjectURL(blob);
        setAudio((s) => ({ ...s, [audioKey]: { status: "done", label: "Prêt", audioUrl, filename: `${sanitizeTitle(videoTitle)}_${language}_edge.mp3` } }));
      } catch (err) {
        setAudio((a) => ({ ...a, [`EDGE_${language}`]: { status: "error", label: String(err) } }));
      }
      return;
    }

    if (provider === "google-tts") {
      const audioKey = `GTTS_${language}`;
      const langCode = GOOGLE_TTS_VOICES[language === "FR" ? "fr" : language === "EN" ? "en" : "de"].langCode;
      setAudio((a) => ({ ...a, [audioKey]: { status: "loading", label: "Génération..." } }));
      try {
        const res = await fetch("/api/tts/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice, languageCode: langCode, speakingRate: speed }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          setAudio((a) => ({ ...a, [audioKey]: { status: "error", label: err.error ?? "Erreur Google TTS" } }));
          return;
        }
        const blob = await res.blob();
        const audioUrl = URL.createObjectURL(blob);
        setAudio((s) => ({ ...s, [audioKey]: { status: "done", label: "Prêt", audioUrl, filename: `${sanitizeTitle(videoTitle)}_${language}_google.mp3` } }));
      } catch (err) {
        setAudio((a) => ({ ...a, [audioKey]: { status: "error", label: String(err) } }));
      }
      return;
    }

    if (provider === "elevenlabs") {
      setAudio((a) => ({ ...a, [language]: { status: "loading", label: "Envoi..." } }));
      try {
        const res = await fetch("/api/tts/elevenlabs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, speed, pitch: 0, volume: 1.0 }),
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

    // ai33-minimax / ai33-elevenlabs
    setAudio((a) => ({ ...a, [language]: { status: "loading", label: "Envoi..." } }));
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language, provider, title: videoTitle, speed, pitch: 0, volume: 1.0 }),
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
      const label = elapsed < 60 ? `${elapsed}s...` : `${Math.floor(elapsed / 60)}min${elapsed % 60 > 0 ? `${elapsed % 60}s` : ""}...`;
      setAudio((a) => ({ ...a, [language]: { status: "loading", label } }));
      try {
        const poll = await fetch(`https://api.ai33.pro/v1/task/${taskId}`, { headers: { "xi-api-key": apiKey } });
        const pollData = await poll.json();
        if (pollData.status === "done" && pollData.audio_url) {
          setAudio((s) => ({ ...s, [language]: { status: "done", label: "Prêt", audioUrl: pollData.audio_url, filename } }));
          return;
        }
      } catch {}
    }
    setAudio((a) => ({ ...a, [language]: { status: "error", label: "Timeout" } }));
  }

  function handleGenerateLang(lang: "FR" | "EN" | "DE", voice: string, speed: number) {
    handleTTS(lang, voice, speed);
  }

  async function handleGenerateAll() {
    // Read current voice configs from localStorage
    const raw = typeof window !== "undefined" ? localStorage.getItem("qr_voice_config_v2") : null;
    const configs = raw ? JSON.parse(raw) : {};

    function getVoiceConfig(lang: string) {
      const key = `${provider}__${lang}`;
      return configs[key] ?? getDefaultVoiceConfig(provider, lang);
    }

    await Promise.allSettled([
      handleTTS("FR", getVoiceConfig("FR").voice, getVoiceConfig("FR").speed),
      handleTTS("EN", getVoiceConfig("EN").voice, getVoiceConfig("EN").speed),
      handleTTS("DE", getVoiceConfig("DE").voice, getVoiceConfig("DE").speed),
    ]);
  }

  function getDefaultVoiceConfig(p: Provider, lang: string): { voice: string; speed: number } {
    const defaults: Record<string, Record<string, { voice: string; speed: number }>> = {
      "ai33-minimax":    { FR: { voice: "273587280617675", speed: 1.0 }, EN: { voice: "273587280617675", speed: 1.0 }, DE: { voice: "273587280617675", speed: 1.0 } },
      "ai33-elevenlabs": { FR: { voice: "aTTiK3YzK3dXETpuDE2h", speed: 1.0 }, EN: { voice: "aTTiK3YzK3dXETpuDE2h", speed: 1.0 }, DE: { voice: "aTTiK3YzK3dXETpuDE2h", speed: 1.0 } },
      "elevenlabs":      { FR: { voice: "aTTiK3YzK3dXETpuDE2h", speed: 1.0 }, EN: { voice: "aTTiK3YzK3dXETpuDE2h", speed: 1.0 }, DE: { voice: "aTTiK3YzK3dXETpuDE2h", speed: 1.0 } },
      "edge-tts":        { FR: { voice: "fr-FR-HenriNeural", speed: 0 }, EN: { voice: "en-US-GuyNeural", speed: 0 }, DE: { voice: "de-DE-KillianNeural", speed: 0 } },
      "google-tts":      { FR: { voice: "fr-FR-Neural2-B", speed: 1.0 }, EN: { voice: "en-US-Neural2-D", speed: 1.0 }, DE: { voice: "de-DE-Neural2-B", speed: 1.0 } },
    };
    return defaults[p]?.[lang] ?? { voice: "", speed: 1.0 };
  }

  // ── Copy all QR ───────────────────────────────────────────────────────────
  function copyAllQR() {
    const parts = SECTIONS.map((section) => {
      const content = getContent(section) ?? "";
      return `=== ${section} ===\n${content}`;
    });
    navigator.clipboard.writeText(parts.join("\n\n"));
  }

  async function handleAdjust(section: Section, dur: AdjustDuration) {
    const text = getContent(section);
    if (!text || adjusting) return;
    const language = section.split(" ")[1];
    setAdjusting(section);
    setOverrides((o) => ({ ...o, [section]: "" }));
    const res = await fetch("/api/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language, targetDuration: dur }),
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

  async function copySection(key: string, text: string) {
    await navigator.clipboard.writeText(`${key}\n\n${text}`);
    setCopied(key);
    toast.success("Copié !");
    setTimeout(() => setCopied(null), 2000);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#F5F5F5]">
      <Header
        history={history}
        showHistory={showHistory}
        onToggleHistory={() => setShowHistory((v) => !v)}
        onRestoreHistory={restoreFromHistory}
        onDeleteHistory={deleteHistoryEntry}
        onClearHistory={clearHistory}
        canReset={step === "transcript" || step === "done"}
        onReset={reset}
        onOpenPalette={() => setShowPalette(true)}
        historyPanelRef={historyPanelRef}
      />

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        {/* Video title */}
        {videoTitle && (
          <p className="text-[12px] font-mono text-[#525252] truncate">
            <span className="text-[#404040]">▸ </span>{videoTitle}
          </p>
        )}

        {/* URL input (idle only) */}
        {step === "idle" && (
          <UrlInput
            value={url}
            onChange={setUrl}
            onSubmit={handleExtract}
            isLoading={false}
            error={error}
          />
        )}

        {/* Extracting state */}
        {step === "extracting" && (
          <div className="space-y-3">
            <UrlInput
              value={url}
              onChange={setUrl}
              onSubmit={handleExtract}
              isLoading={true}
              error=""
            />
            <p className="text-[12px] font-mono text-[#525252]">Extraction du transcript…</p>
          </div>
        )}

        {/* Transcript step */}
        {(step === "transcript" || step === "rewriting" || step === "done") && transcriptText && (
          <details className="group bg-[#141414] border border-[#262626] overflow-hidden" style={{ borderRadius: "8px" }}>
            <summary className="flex items-center justify-between px-4 py-2.5 cursor-pointer list-none select-none hover:bg-[#1C1C1C] transition-none">
              <span className="text-[10px] font-mono font-semibold text-[#A3A3A3] tracking-widest uppercase flex items-center gap-2">
                <span className="group-open:rotate-90 inline-block transition-none">▸</span>
                Transcript · {transcriptText.split(/\s+/).filter(Boolean).length} mots
              </span>
              <button
                onClick={async (e) => {
                  e.preventDefault();
                  await navigator.clipboard.writeText(transcriptText);
                  setCopiedTranscript(true);
                  toast.success("Transcript copié");
                  setTimeout(() => setCopiedTranscript(false), 1500);
                }}
                className="text-[10px] font-mono text-[#525252] hover:text-[#F5F5F5] transition-none"
              >
                {copiedTranscript ? "Copié !" : "Copier"}
              </button>
            </summary>
            <p className="px-4 py-3 text-[12px] text-[#A3A3A3] font-sans whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto border-t border-[#262626]">
              {transcriptText}
            </p>
          </details>
        )}

        {/* Transcript step — generate button */}
        {step === "transcript" && (
          <button
            onClick={() => handleRewrite(transcriptText, videoTitle)}
            className="w-full h-12 bg-[#F5F5F5] text-[#0A0A0A] text-[13px] font-mono font-semibold hover:bg-transparent hover:text-[#F5F5F5] border border-[#F5F5F5] transition-none"
            style={{ borderRadius: "8px" }}
          >
            Générer le QR
          </button>
        )}

        {/* Rewriting state — streaming preview */}
        {step === "rewriting" && (
          <div className="bg-[#141414] border border-[#262626] p-4 space-y-2" style={{ borderRadius: "8px" }}>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#F59E0B] animate-pulse" />
              <span className="text-[10px] font-mono text-[#525252] tracking-widest uppercase">Réécriture en cours…</span>
            </div>
            {qrText && (
              <p className="text-[12px] font-sans text-[#A3A3A3] whitespace-pre-wrap leading-relaxed line-clamp-6">
                {qrText}
              </p>
            )}
          </div>
        )}

        {/* Done — Generation panel + Scripts */}
        {step === "done" && (
          <div className="space-y-6">

            {/* Generation panel */}
            <GenerationPanel
              provider={provider}
              onProviderChange={setProvider}
              targetDuration={targetDuration}
              onDurationChange={setTargetDuration}
              audio={audio}
              onGenerate={handleGenerateLang}
              onGenerateAll={handleGenerateAll}
              onCopyAllQR={copyAllQR}
              disabled={isLoading}
            />

            {/* Script cards — grid 3-col on md+ */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {SCRIPT_SECTIONS.map((section) => {
                const content = getContent(section);
                if (!content && !sections[section]) return null;
                const displayContent = content ?? "";
                const stats = displayContent ? wordStats(displayContent) : null;
                const lang = section.split(" ")[1];
                const audioKey = provider === "edge-tts" ? `EDGE_${lang}` : provider === "google-tts" ? `GTTS_${lang}` : lang;
                const audioState = audio[audioKey];
                const isAdjusting = adjusting === section;
                const hasOverride = section in overrides;

                return (
                  <ScriptCard
                    key={section}
                    section={section}
                    content={displayContent}
                    stats={stats}
                    adjustDurations={ADJUST_DURATIONS}
                    isAdjusting={isAdjusting}
                    hasOverride={hasOverride}
                    adjusting={!!adjusting}
                    audioState={audioState}
                    isCopied={copied === section}
                    onCopy={() => copySection(section, displayContent)}
                    onAdjust={(dur) => handleAdjust(section, dur)}
                    onRestore={() => setOverrides((o) => { const n = { ...o }; delete n[section]; return n; })}
                  />
                );
              })}
            </div>

            {/* Other sections (keywords, hashtags) */}
            <div className="space-y-3">
              {(SECTIONS.filter((s) => !SCRIPT_SECTIONS.includes(s as Section)) as Section[]).map((section) => {
                const content = getContent(section);
                if (!content && !sections[section]) return null;
                const displayContent = content ?? "";
                return (
                  <div key={section} className="bg-[#141414] border border-[#262626] overflow-hidden" style={{ borderRadius: "8px" }}>
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#262626]">
                      <span className="text-[10px] font-mono font-semibold text-[#A3A3A3] tracking-widest uppercase">
                        {section}
                      </span>
                      <button
                        onClick={() => copySection(section, displayContent)}
                        className="text-[10px] font-mono text-[#525252] hover:text-[#F5F5F5] transition-none"
                      >
                        {copied === section ? "Copié ✓" : "Copier"}
                      </button>
                    </div>
                    <p className="px-4 py-3 text-[13px] font-sans text-[#F5F5F5] whitespace-pre-wrap leading-relaxed">
                      {displayContent}
                    </p>
                  </div>
                );
              })}
            </div>

            <p className="text-center text-[#525252] text-[10px] font-mono py-4">
              Prêt pour le prochain script !
            </p>
          </div>
        )}
      </main>

      <footer className="text-center text-[#262626] text-[10px] font-mono py-6 mt-8">
        DAV Pipeline · 2026
      </footer>
    </div>
  );
}

// ── ScriptCard (inline for now, extracted in Phase 4) ─────────────────────────
type ScriptCardProps = {
  section: Section;
  content: string;
  stats: { words: number; duration: string } | null;
  adjustDurations: readonly AdjustDuration[];
  isAdjusting: boolean;
  hasOverride: boolean;
  adjusting: boolean;
  audioState?: AudioState;
  isCopied: boolean;
  onCopy: () => void;
  onAdjust: (dur: AdjustDuration) => void;
  onRestore: () => void;
};

function ScriptCard({
  section, content, stats, adjustDurations, isAdjusting, hasOverride,
  adjusting, audioState, isCopied, onCopy, onAdjust, onRestore,
}: ScriptCardProps) {
  return (
    <div className="bg-[#141414] border border-[#262626] overflow-hidden flex flex-col" style={{ borderRadius: "8px" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#262626]">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-semibold text-[#A3A3A3] tracking-widest uppercase">
            {section}
          </span>
          {stats && (
            <span className="text-[10px] font-mono text-[#525252]">
              {stats.words}w · {stats.duration}
            </span>
          )}
          {isAdjusting && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-[#525252]">
              <span className="w-2 h-2 rounded-full bg-[#F59E0B] animate-pulse" />
              Réécriture…
            </span>
          )}
          {hasOverride && !isAdjusting && (
            <button
              onClick={onRestore}
              className="text-[10px] font-mono text-[#525252] hover:text-[#F5F5F5] transition-none"
            >
              ↩ Original
            </button>
          )}
        </div>
        <button
          onClick={onCopy}
          className="text-[10px] font-mono text-[#525252] hover:text-[#F5F5F5] transition-none"
        >
          {isCopied ? "Copié ✓" : "Copier"}
        </button>
      </div>

      {/* Body */}
      <div className="px-3 py-3 flex-1">
        <p className="text-[13px] font-sans text-[#F5F5F5] whitespace-pre-wrap leading-[1.7]">
          {content}
        </p>
      </div>

      {/* Audio player if done */}
      {audioState?.status === "done" && audioState.audioUrl && (
        <div className="px-3 py-2 border-t border-[#262626]">
          <audio controls src={audioState.audioUrl} className="w-full h-8" />
          {audioState.filename && (
            <a
              href={audioState.audioUrl}
              download={audioState.filename}
              className="text-[10px] font-mono text-[#525252] hover:text-[#F5F5F5] transition-none mt-1 inline-block"
            >
              ↓ {audioState.filename}
            </a>
          )}
        </div>
      )}

      {/* Footer — adjust durations */}
      <div className="px-3 py-2 border-t border-[#262626] flex flex-wrap gap-1">
        {adjustDurations.map((d) => (
          <button
            key={d}
            onClick={() => onAdjust(d)}
            disabled={adjusting}
            className="text-[10px] font-mono px-2 py-0.5 border border-[#262626] text-[#525252] hover:border-[#404040] hover:text-[#F5F5F5] disabled:opacity-40 transition-none"
            style={{ borderRadius: "3px" }}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}
