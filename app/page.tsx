"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import { Header } from "../components/Header";
import { UrlInput } from "../components/UrlInput";
import { GenerationPanel } from "../components/GenerationPanel";
import { ScriptCard } from "../components/ScriptCard";
import { CommandPalette } from "../components/CommandPalette";
import { FloatingActions } from "../components/FloatingActions";
import { MaintenanceGate } from "../components/MaintenanceGate";
import { EDGE_TTS_VOICES } from "../lib/edge-tts-voices";
import { GOOGLE_TTS_VOICES } from "../lib/google-tts-voices";
import { GEMINI_STYLE_DEFAULT, GEMINI_PACE_DEFAULT, GEMINI_ACCENT_DEFAULT } from "../lib/gemini-tts-voices";
import { sanitizeTitle, wordStats } from "../lib/format";
import type { Provider, Section, AudioState, Step, HistoryEntry, AuthUser } from "../types";
import { SECTIONS } from "../types";
import { supabase } from "../lib/supabase";
import type { GenerationRow } from "../lib/supabase";
import { VOICE_CONFIG_STORAGE_KEY, type VoiceConfig } from "../hooks/useVoiceConfig";

// ── Constants ─────────────────────────────────────────────────────────────────
const SCRIPT_SECTIONS: Section[] = ["SCRIPT FR", "SCRIPT EN", "SCRIPT DE", "SCRIPT ES"];

const CTA_TEXTS: Record<string, string> = {
  FR: "Savais-tu que Cristiano sourit quand tu tapes sur le bouton plus ?",
  EN: "Did you know Cristiano smiles when you tap the plus button?",
  DE: "Wusstest du, dass Cristiano lächelt, wenn du auf Plus tippst?",
  ES: "¿Sabías que Cristiano sonríe cuando tocas el botón plus?",
};

function filterKeywords(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      // Strip leading markers: "1.", "2)", bullets •, dashes -, asterisks *
      let clean = line.trim()
        .replace(/^\d+[.)]\s*/, "")
        .replace(/^[•\-\*]\s*/, "")
        .trim();
      // Strip trailing punctuation
      clean = clean.replace(/[.,:;!?]+$/, "").trim();
      // Truncate to 4 words max
      const words = clean.split(/\s+/).filter(Boolean);
      return words.slice(0, 5).join(" ");
    })
    .filter((line) => line.length > 0)
    .join("\n");
}

function insertCTA(text: string, lang: string, position: number): string {
  const cta = CTA_TEXTS[lang];
  if (!cta || !text.trim()) return text;
  const parts: string[] = [];
  let pos = 0;
  const re = /[.!?…]+\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const chunk = text.slice(pos, m.index + m[0].length).trim();
    if (chunk) parts.push(chunk);
    pos = m.index + m[0].length;
  }
  if (pos < text.length) { const tail = text.slice(pos).trim(); if (tail) parts.push(tail); }
  if (parts.length < 2) return `${text.trim()} ${cta}`;
  // position is 2, 3, or 4 — insert after that sentence (0-based: position - 1).
  const target = position - 1;
  const insertAfter = Math.min(target, parts.length - 2);
  console.log("[insertCTA]", { position, partsLength: parts.length, target, insertAfter });
  return [...parts.slice(0, insertAfter + 1), cta, ...parts.slice(insertAfter + 1)].join(" ");
}
const ADJUST_DURATIONS = ["10s", "15s", "30s", "45s", "1min30", "2min"] as const;
type AdjustDuration = (typeof ADJUST_DURATIONS)[number];

const HISTORY_KEY = "qr_pipeline_history";
const MAX_HISTORY = 50;
const TAB_KEY = "dav_active_tab";
type Tab = "scripts" | "download";

// ── Helpers ───────────────────────────────────────────────────────────────────
function cleanContent(raw: string): string {
  return raw
    .replace(/\n*SECTION\s+\d+[^\n]*$/i, "")
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
  // Maintenance gate — production only, skipped entirely on localhost.
  // "loading" avoids flashing the real app before we know the hostname.
  const [gateState, setGateState] = useState<"loading" | "show-app" | "show-gate">("loading");

  useEffect(() => {
    try {
      const host = window.location.hostname;
      const isLocalhost = host === "localhost" || host === "127.0.0.1";
      const isUnlocked = localStorage.getItem("dav_owner_unlocked") === "true";
      setGateState(isLocalhost || isUnlocked ? "show-app" : "show-gate");
    } catch {
      setGateState("show-app");
    }
  }, []);

  const [url, setUrl] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [videoTitle, setVideoTitle] = useState("");
  const [qrText, setQrText] = useState("");
  const [error, setError] = useState("");
  const [provider, setProvider] = useState<Provider>("ai33-minimax");
  const [audio, setAudio] = useState<Record<string, AudioState>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [overrides, setOverrides] = useState<Partial<Record<Section, string>>>({});
  const [adjusting, setAdjusting] = useState<Section | null>(null);
  const [transcriptText, setTranscriptText] = useState("");
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [manualText, setManualText] = useState("");
  const [targetDuration, setTargetDuration] = useState<AdjustDuration | "original">("original");
  const [customSeconds, setCustomSeconds] = useState<number | null>(null);

  // CTA toggle
  const [ctaEnabled, setCtaEnabled] = useState(false);
  const [ctaPosition, setCtaPosition] = useState(2);

  // Per-generation CTA choice (asked after extraction, before rewrite — not persisted)
  const [showCtaChoice, setShowCtaChoice] = useState(false);
  const [pendingRewrite, setPendingRewrite] = useState<{ text: string; title: string } | null>(null);

  // History
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const historyPanelRef = useRef<HTMLDivElement>(null);
  const latestHistoryIdRef = useRef<string | null>(null);

  // Auth + cloud history
  const [user, setUser] = useState<AuthUser | null>(null);
  const [cloudHistory, setCloudHistory] = useState<GenerationRow[]>([]);
  const [healthScores, setHealthScores] = useState<Record<string, { score: number; feedback?: string | null }>>({});
  const [correctingLangs, setCorrectingLangs] = useState<Record<string, boolean>>({});

  // Command palette
  const [showPalette, setShowPalette] = useState(false);

  // Tab switcher
  const [activeTab, setActiveTab] = useState<Tab>("scripts");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setHistory(
            (parsed as unknown[])
              .filter((e): e is HistoryEntry =>
                typeof e === "object" && e !== null && typeof (e as Record<string, unknown>).id === "string"
              )
              .map((e) => {
                const entry = e as Record<string, unknown>;
                // Migrate old entries: date → createdAt, add step
                if (!entry.createdAt && entry.date) entry.createdAt = entry.date;
                if (!entry.step) entry.step = "done";
                if (!entry.healthScores) entry.healthScores = {};
                return entry as unknown as HistoryEntry;
              })
          );
        }
      }
      if (localStorage.getItem("cta_enabled") === "1") setCtaEnabled(true);
      const savedTab = localStorage.getItem(TAB_KEY) as Tab | null;
      if (savedTab === "scripts" || savedTab === "download") setActiveTab(savedTab);
      const savedPos = Number(localStorage.getItem("cta_position"));
      if (savedPos === 2 || savedPos === 3 || savedPos === 4) setCtaPosition(savedPos);
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

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUser(data.user as AuthUser);
        loadCloudHistory();
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u as AuthUser | null);
      if (u) loadCloudHistory();
      else setCloudHistory([]);
    });
    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useHotkeys("mod+k", (e) => { e.preventDefault(); setShowPalette((v) => !v); });
  useHotkeys("mod+shift+c", (e) => { e.preventDefault(); if (step === "done") { copyAllQR(); toast.success("QR copié !"); } });
  useHotkeys("1", () => { const a = audio["FR"] ?? audio["EDGE_FR"] ?? audio["GTTS_FR"] ?? audio["GEMINI_FR"]; if (a?.audioUrl) playAudio(a.audioUrl); }, { enabled: step === "done" });
  useHotkeys("2", () => { const a = audio["EN"] ?? audio["EDGE_EN"] ?? audio["GTTS_EN"] ?? audio["GEMINI_EN"]; if (a?.audioUrl) playAudio(a.audioUrl); }, { enabled: step === "done" });
  useHotkeys("3", () => { const a = audio["DE"] ?? audio["EDGE_DE"] ?? audio["GTTS_DE"] ?? audio["GEMINI_DE"]; if (a?.audioUrl) playAudio(a.audioUrl); }, { enabled: step === "done" });
  useHotkeys("4", () => { const a = audio["ES"] ?? audio["EDGE_ES"] ?? audio["GTTS_ES"] ?? audio["GEMINI_ES"]; if (a?.audioUrl) playAudio(a.audioUrl); }, { enabled: step === "done" });

  function saveToHistory(title: string, currentUrl: string, text: string, transcript: string) {
    const id = Date.now().toString();
    latestHistoryIdRef.current = id;
    const entry: HistoryEntry = {
      id,
      createdAt: new Date().toISOString(),
      title,
      url: currentUrl,
      qrText: text,
      provider,
      step: "done",
      transcriptText: transcript,
      healthScores: {},
    };
    setHistory((prev) => {
      const updated = [entry, ...prev].slice(0, MAX_HISTORY);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }

  function updateHistoryHealthScores(id: string, scores: Record<string, { score: number; feedback?: string | null }>) {
    const simpleScores: Record<string, number> = {};
    for (const [lang, data] of Object.entries(scores)) {
      simpleScores[lang] = data.score;
    }
    setHistory((prev) => {
      const updated = prev.map((h) => h.id === id ? { ...h, healthScores: simpleScores } : h);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }

  function restoreFromHistory(entry: HistoryEntry) {
    // Reset transient state
    setError("");
    setAudio({});
    setOverrides({});
    setAdjusting(null);
    setCorrectingLangs({});
    setCopied(null);
    setCopiedTranscript(false);
    setCopiedUrl(false);
    // Restore entry state
    setUrl(entry.url);
    setVideoTitle(entry.title);
    setQrText(entry.qrText);
    setProvider(entry.provider);
    setTranscriptText(entry.transcriptText ?? "");
    setHealthScores(
      Object.fromEntries(
        Object.entries(entry.healthScores ?? {}).map(([lang, score]) => [lang, { score }])
      )
    );
    setStep("done");
    setShowHistory(false);
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

  // ── Cloud auth helpers ────────────────────────────────────────────────────
  async function loadCloudHistory() {
    if (!supabase) return;
    const { data } = await supabase
      .from("generations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setCloudHistory(data as GenerationRow[]);
  }

  async function handleLogin() {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: typeof window !== "undefined" ? window.location.origin : "/" },
    });
  }

  async function handleLogout() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
    setCloudHistory([]);
  }

  function restoreFromCloudHistory(gen: GenerationRow) {
    const parts: string[] = [];
    if (gen.script_fr) parts.push(`SCRIPT FR\n${gen.script_fr}`);
    if (gen.script_en) parts.push(`SCRIPT EN\n${gen.script_en}`);
    if (gen.script_de) parts.push(`SCRIPT DE\n${gen.script_de}`);
    if (gen.script_es) parts.push(`SCRIPT ES\n${gen.script_es}`);
    if (gen.titre_fr) parts.push(`TITRE ET HASHTAGS FR\n${gen.titre_fr}`);
    if (gen.titre_en) parts.push(`TITRE ET HASHTAGS EN\n${gen.titre_en}`);
    if (gen.titre_de) parts.push(`TITRE ET HASHTAGS DE\n${gen.titre_de}`);
    if (gen.titre_es) parts.push(`TITRE ET HASHTAGS ES\n${gen.titre_es}`);
    const reconstructed = parts.join("\n\n");
    reset();
    setTimeout(() => {
      setVideoTitle(gen.video_title ?? "");
      setUrl("");
      setQrText(reconstructed);
      setStep("done");
      setShowHistory(false);
    }, 50);
  }

  function saveToCloud(qrText: string, title: string) {
    if (!supabase || !user) return;
    const parsed = parseQR(qrText);
    void (async () => {
      try {
        await supabase.from("generations").insert({
          user_id: user.id,
          video_title: title,
          script_fr: parsed["SCRIPT FR"] ?? null,
          script_en: parsed["SCRIPT EN"] ?? null,
          script_de: parsed["SCRIPT DE"] ?? null,
          script_es: parsed["SCRIPT ES"] ?? null,
          titre_fr: parsed["TITRE ET HASHTAGS FR"] ?? null,
          titre_en: parsed["TITRE ET HASHTAGS EN"] ?? null,
          titre_de: parsed["TITRE ET HASHTAGS DE"] ?? null,
          titre_es: parsed["TITRE ET HASHTAGS ES"] ?? null,
        });
        loadCloudHistory();
      } catch {}
    })();
  }

  const sections = step === "done" ? parseQR(qrText) : {};
  const isLoading = step === "extracting" || step === "rewriting";

  function getContent(section: Section): string | undefined {
    return overrides[section] ?? sections[section];
  }

  function reset() {
    setUrl("");
    setManualText("");
    setStep("idle");
    setVideoTitle("");
    setQrText("");
    setError("");
    setAudio({});
    setCopied(null);
    setCopiedUrl(false);
    setHealthScores({});
    setCorrectingLangs({});
    setOverrides({});
    setAdjusting(null);
    setTranscriptText("");
    setCopiedTranscript(false);
    setTargetDuration("original");
    setShowCtaChoice(false);
    setPendingRewrite(null);
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
    setPendingRewrite({ text: data.text, title: data.title });
    setStep("transcript");
    setShowCtaChoice(true);
  }

  // ── Manual transcript ───────────────────────────────────────────────────────
  // Paste text directly and skip URL extraction — go straight to the CTA prompt.
  async function handleManualSubmit() {
    const text = manualText.trim();
    if (!text || isLoading) return;
    setError("");
    setQrText("");
    const title = "Transcript manuel";
    setVideoTitle(title);
    setTranscriptText(text);
    setPendingRewrite({ text, title });
    setStep("transcript");
    setShowCtaChoice(true);
  }

  // ── CTA choice (per-generation only, not persisted) ─────────────────────────
  function chooseCta(choice: "none" | "p3" | "p4") {
    if (choice === "none") {
      setCtaEnabled(false);
    } else {
      setCtaEnabled(true);
      setCtaPosition(choice === "p3" ? 3 : 4);
    }
    setShowCtaChoice(false);
    if (pendingRewrite) {
      const { text, title } = pendingRewrite;
      setPendingRewrite(null);
      void handleRewrite(text, title);
    }
  }

  async function singleLangHealthCheck(lang: string, script: string, transcript: string): Promise<{ score: number; feedback?: string | null }> {
    const scripts: Record<string, string> = { FR: "", EN: "", DE: "", ES: "" };
    scripts[lang] = script;
    try {
      const res = await fetch("/api/health-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scripts, transcript }),
      });
      if (!res.ok) return { score: 0 };
      const data: { scores?: Record<string, number>; feedback?: Record<string, string | null> } = await res.json();
      return { score: data.scores?.[lang] ?? 0, feedback: data.feedback?.[lang] ?? null };
    } catch { return { score: 0 }; }
  }

  async function autoCorrect(lang: string, script: string, feedback: string, transcript: string, attempt: number) {
    if (attempt >= 2) {
      setCorrectingLangs((c) => { const n = { ...c }; delete n[lang]; return n; });
      return;
    }
    setCorrectingLangs((c) => ({ ...c, [lang]: true }));

    const res = await fetch("/api/correct-script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script, lang, feedback, transcript }),
    });
    if (!res.ok || !res.body) {
      setCorrectingLangs((c) => { const n = { ...c }; delete n[lang]; return n; });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";
    const section = `SCRIPT ${lang}` as Section;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulated += decoder.decode(value, { stream: true });
      setOverrides((o) => ({ ...o, [section]: accumulated }));
    }

    const newHealth = await singleLangHealthCheck(lang, accumulated, transcript);
    setHealthScores((h) => ({ ...h, [lang]: newHealth }));

    if (newHealth.score < 80 && attempt < 1) {
      await autoCorrect(lang, accumulated, newHealth.feedback ?? "", transcript, attempt + 1);
    } else {
      setCorrectingLangs((c) => { const n = { ...c }; delete n[lang]; return n; });
    }
  }

  async function runHealthCheck(scripts: Record<string, string>, transcript: string) {
    setHealthScores({});
    try {
      const res = await fetch("/api/health-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scripts, transcript }),
      });
      if (!res.ok) return;
      const data: { scores?: Record<string, number>; feedback?: Record<string, string | null> } = await res.json();
      if (data.scores) {
        const merged: Record<string, { score: number; feedback?: string | null }> = {};
        for (const lang of ["FR", "EN", "DE", "ES"]) {
          merged[lang] = { score: data.scores[lang] ?? 0, feedback: data.feedback?.[lang] ?? null };
        }
        setHealthScores(merged);
        if (latestHistoryIdRef.current) {
          updateHistoryHealthScores(latestHistoryIdRef.current, merged);
        }
        // Auto-correct any language scoring below 80
        for (const lang of ["FR", "EN", "DE", "ES"]) {
          if ((data.scores[lang] ?? 100) < 80 && scripts[lang]) {
            void autoCorrect(lang, scripts[lang], data.feedback?.[lang] ?? "", transcript, 0);
          }
        }
      }
    } catch {}
  }

  // ── Rewrite ───────────────────────────────────────────────────────────────
  function durationToSeconds(d: AdjustDuration | "original"): number | "original" {
    if (d === "original") return "original";
    if (d === "10s") return 10;
    if (d === "15s") return 15;
    if (d === "30s") return 30;
    if (d === "45s") return 45;
    if (d === "1min30") return 90;
    if (d === "2min") return 120;
    return "original";
  }

  async function handleRewrite(text: string, title?: string) {
    setStep("rewriting");
    const targetSeconds = customSeconds !== null ? customSeconds : durationToSeconds(targetDuration);

    const res = await fetch("/api/rewrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, targetSeconds }),
    });

    if (!res.ok || !res.body) {
      setError("Erreur réécriture");
      setStep("idle");
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
    const parsed = parseQR(accumulated);
    void runHealthCheck(
      {
        FR: parsed["SCRIPT FR"] ?? "",
        EN: parsed["SCRIPT EN"] ?? "",
        DE: parsed["SCRIPT DE"] ?? "",
        ES: parsed["SCRIPT ES"] ?? "",
      },
      text
    );
    const finalTitle = title ?? videoTitle;
    if (finalTitle) {
      saveToHistory(finalTitle, url, accumulated, text);
      saveToCloud(accumulated, finalTitle);
    }
  }

  // ── TTS ───────────────────────────────────────────────────────────────────
  async function handleTTS(language: "EN" | "DE" | "FR" | "ES", voice: string, speed: number, modelId?: string, geminiParams?: { style: string; pace: string; accent: string }) {
    const sectionKey = `SCRIPT ${language}` as Section;
    const rawText = getContent(sectionKey);
    console.log(`[handleTTS] lang=${language} sectionKey=${sectionKey} textLength=${rawText?.length ?? 0} step=${step}`);
    if (!rawText) return;
    const text = ctaEnabled ? insertCTA(rawText, language, ctaPosition) : rawText;

    const filename = `DAV_${language}_${Date.now()}.mp3`;

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
      const langCode = GOOGLE_TTS_VOICES[language === "FR" ? "fr" : language === "EN" ? "en" : language === "DE" ? "de" : "es"].langCode;
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

    if (provider === "google-ai-studio") {
      const audioKey = `GEMINI_${language}`;
      setAudio((a) => ({ ...a, [audioKey]: { status: "loading", label: "Génération..." } }));
      try {
        const res = await fetch("/api/tts/gemini", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            voiceName: voice,
            style: geminiParams?.style ?? GEMINI_STYLE_DEFAULT,
            pace: geminiParams?.pace ?? GEMINI_PACE_DEFAULT,
            accent: geminiParams?.accent ?? GEMINI_ACCENT_DEFAULT,
            speed,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          setAudio((a) => ({ ...a, [audioKey]: { status: "error", label: err.error ?? "Erreur Gemini TTS" } }));
          return;
        }
        const blob = await res.blob();
        const audioUrl = URL.createObjectURL(blob);
        setAudio((s) => ({ ...s, [audioKey]: { status: "done", label: "Prêt", audioUrl, filename: `DAV_${language}_gemini_${Date.now()}.wav` } }));
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
          body: JSON.stringify({ text, voice_id: voice, model_id: modelId, speed }),
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
      body: JSON.stringify({ text, language, provider, title: videoTitle, speed, voice, model_id: modelId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setAudio((a) => ({ ...a, [language]: { status: "error", label: data.error ?? "Erreur" } }));
      return;
    }
    const { taskId } = data;
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
        const poll = await fetch(`/api/tts/poll?taskId=${encodeURIComponent(taskId)}&provider=${encodeURIComponent(provider)}`);
        if (poll.ok) {
          const pollData = await poll.json();
          const { audio_url: audioUrl } = pollData;
          if (audioUrl && audioUrl.startsWith("http")) {
            setAudio((a) => ({ ...a, [language]: { status: "loading", label: "Téléchargement..." } }));
            try {
              const proxyRes = await fetch(`/api/tts/audio?url=${encodeURIComponent(audioUrl)}`);
              if (proxyRes.ok) {
                const blob = await proxyRes.blob();
                const localUrl = URL.createObjectURL(blob);
                setAudio((s) => ({ ...s, [language]: { status: "done", label: "Prêt", audioUrl: localUrl, originalUrl: audioUrl, filename } }));
                return;
              }
            } catch {}
            // Fallback: direct URL if proxy fails
            setAudio((s) => ({ ...s, [language]: { status: "done", label: "Prêt", audioUrl, originalUrl: audioUrl, filename } }));
            return;
          }
        }
      } catch {}
    }
    setAudio((a) => ({ ...a, [language]: { status: "error", label: "Timeout" } }));
  }

  function handleGenerateLang(lang: "FR" | "EN" | "DE" | "ES", voice: string, speed: number, modelId?: string, geminiParams?: { style: string; pace: string; accent: string }) {
    handleTTS(lang, voice, speed, modelId, geminiParams);
  }

  async function handleGenerateAll() {
    const raw = typeof window !== "undefined" ? localStorage.getItem(VOICE_CONFIG_STORAGE_KEY) : null;
    const configs: Record<string, VoiceConfig> = raw ? JSON.parse(raw) : {};

    function getVoiceConfig(lang: string): VoiceConfig {
      const key = `${provider}__${lang}`;
      return configs[key] ?? getDefaultVoiceConfig(provider, lang);
    }

    function getModelId(lang: string): string | undefined {
      try { return localStorage.getItem(`el_model_${lang}`) ?? undefined; } catch { return undefined; }
    }

    function getGeminiParams(cfg: VoiceConfig): { style: string; pace: string; accent: string } | undefined {
      if (provider !== "google-ai-studio") return undefined;
      return {
        style: cfg.style ?? GEMINI_STYLE_DEFAULT,
        pace: cfg.pace ?? GEMINI_PACE_DEFAULT,
        accent: cfg.accent ?? GEMINI_ACCENT_DEFAULT,
      };
    }

    await Promise.allSettled(
      (["FR", "EN", "DE", "ES"] as const).map((lang) => {
        const cfg = getVoiceConfig(lang);
        return handleTTS(lang, cfg.voice, cfg.speed, getModelId(lang), getGeminiParams(cfg));
      })
    );
  }

  function getDefaultVoiceConfig(p: Provider, lang: string): VoiceConfig {
    const defaults: Record<string, Record<string, VoiceConfig>> = {
      "ai33-minimax":    { FR: { voice: "clone_2580971", speed: 1.0 }, EN: { voice: "clone_2608233", speed: 1.0 }, DE: { voice: "clone_2608233", speed: 1.0 }, ES: { voice: "clone_2608233", speed: 1.0 } },
      "ai33-elevenlabs": { FR: { voice: "elevenlabs_6DsgX00trsI64jl83WWS", speed: 1.0 }, EN: { voice: "elevenlabs_6DsgX00trsI64jl83WWS", speed: 1.0 }, DE: { voice: "elevenlabs_6DsgX00trsI64jl83WWS", speed: 1.0 }, ES: { voice: "elevenlabs_6DsgX00trsI64jl83WWS", speed: 1.0 } },
      "elevenlabs":      { FR: { voice: "6DsgX00trsI64jl83WWS", speed: 1.0 }, EN: { voice: "6DsgX00trsI64jl83WWS", speed: 1.0 }, DE: { voice: "6DsgX00trsI64jl83WWS", speed: 1.0 }, ES: { voice: "6DsgX00trsI64jl83WWS", speed: 1.0 } },
      "edge-tts":        { FR: { voice: "fr-FR-HenriNeural", speed: 0 }, EN: { voice: "en-US-GuyNeural", speed: 0 }, DE: { voice: "de-DE-KillianNeural", speed: 0 }, ES: { voice: "es-ES-AlvaroNeural", speed: 0 } },
      "google-tts":      { FR: { voice: "fr-FR-Neural2-B", speed: 1.0 }, EN: { voice: "en-US-Neural2-D", speed: 1.0 }, DE: { voice: "de-DE-Neural2-B", speed: 1.0 }, ES: { voice: "es-ES-Neural2-B", speed: 1.0 } },
      "google-ai-studio": {
        FR: { voice: "Schedar", speed: 1.0, style: "Promo/Hype", pace: "Rapid Fire", accent: "Neutral" },
        EN: { voice: "Schedar", speed: 1.0, style: "Promo/Hype", pace: "Rapid Fire", accent: "Neutral" },
        DE: { voice: "Schedar", speed: 1.0, style: "Promo/Hype", pace: "Rapid Fire", accent: "Neutral" },
        ES: { voice: "Schedar", speed: 1.0, style: "Promo/Hype", pace: "Rapid Fire", accent: "Neutral" },
      },
    };
    return defaults[p]?.[lang] ?? { voice: "", speed: 1.0 };
  }

  // ── Audio helpers ─────────────────────────────────────────────────────────
  function playAudio(url: string) {
    const el = new Audio(url);
    el.play().catch(() => {});
  }

  // ── Copy all QR ───────────────────────────────────────────────────────────
  function copyAllQR() {
    const parts = SECTIONS.map((section, i) => {
      const content = getContent(section) ?? "";
      return `SECTION ${i + 1}\n${section}\n${content}`;
    });
    navigator.clipboard.writeText(parts.join("\n\n"));
  }

  async function handleAdjustCore(section: Section, body: Record<string, unknown>) {
    const language = section.split(" ")[1];
    setAdjusting(section);
    setOverrides((o) => ({ ...o, [section]: "" }));
    const res = await fetch("/api/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, ...body }),
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
    void singleLangHealthCheck(language, accumulated, transcriptText).then((h) => {
      setHealthScores((hs) => ({ ...hs, [language]: h }));
    });
  }

  async function handleAdjust(section: Section, dur: AdjustDuration) {
    const text = getContent(section);
    if (!text || adjusting) return;
    await handleAdjustCore(section, { text, targetDuration: dur });
  }

  async function handleAdjustCustom(section: Section, seconds: number) {
    const text = getContent(section);
    if (!text || adjusting) return;
    await handleAdjustCore(section, { text, customSeconds: seconds });
  }

  async function copySection(key: string, text: string) {
    const isTitre = key.startsWith("TITRE ET HASHTAGS");
    const formatted = isTitre ? `${key}\n${text}` : `${key}\n\n${text}`;
    await navigator.clipboard.writeText(formatted);
    setCopied(key);
    toast.success("Copié !");
    setTimeout(() => setCopied(null), 1500);
  }

  function getVoiceConfigForLang(lang: string) {
    const raw = typeof window !== "undefined" ? localStorage.getItem(VOICE_CONFIG_STORAGE_KEY) : null;
    const configs = raw ? (JSON.parse(raw) as Record<string, VoiceConfig>) : {};
    return configs[`${provider}__${lang}`] ?? getDefaultVoiceConfig(provider, lang);
  }

  function toggleCTA(v: boolean) {
    setCtaEnabled(v);
    try { localStorage.setItem("cta_enabled", v ? "1" : "0"); } catch {}
  }

  function handleCtaPositionChange(pos: number) {
    setCtaPosition(pos);
    try { localStorage.setItem("cta_position", String(pos)); } catch {}
    if (!ctaEnabled) toggleCTA(true);
  }

  function switchTab(tab: Tab) {
    setActiveTab(tab);
    try { localStorage.setItem(TAB_KEY, tab); } catch {}
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (gateState === "loading") {
    return <div className="min-h-screen bg-[#090d0f]" />;
  }

  if (gateState === "show-gate") {
    return <MaintenanceGate onUnlock={() => setGateState("show-app")} />;
  }

  return (
    <div className="min-h-screen bg-[#090d0f] text-[#e0f0e8] relative z-[1]">
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
        ctaEnabled={ctaEnabled}
        ctaPosition={ctaPosition}
        onCtaPositionChange={handleCtaPositionChange}
        onCtaToggle={() => toggleCTA(!ctaEnabled)}
        user={user}
        cloudHistory={cloudHistory}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onRestoreCloud={restoreFromCloudHistory}
      />

      {/* Tab switcher */}
      <div style={{ borderBottom: "1px solid #1a2e25" }}>
        <div className="max-w-5xl mx-auto px-4 flex">
          {(["scripts", "download"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => switchTab(tab)}
              className="px-4 py-2.5 text-[11px] font-mono font-semibold tracking-widest uppercase transition-none"
              style={{
                color: activeTab === tab ? "#00e5a0" : "#4a6a58",
                borderBottom: activeTab === tab ? "2px solid #00e5a0" : "2px solid transparent",
                marginBottom: "-1px",
              }}
            >
              {tab === "scripts" ? "Scripts" : "Download"}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "download" ? (
        <iframe
          src={`${process.env.NEXT_PUBLIC_DOWNLOADER_URL ?? ""}/app`}
          title="DAV Download"
          style={{ width: "100%", height: "100vh", border: "none", display: "block" }}
        />
      ) : (
        <>
      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        {/* Video title */}
        {videoTitle && (
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-[12px] font-mono text-[#4a6a58] truncate min-w-0 flex-1">
              <span className="text-[#223a2f]">▸ </span>{videoTitle}
            </p>
            {url && (
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(url);
                  setCopiedUrl(true);
                  setTimeout(() => setCopiedUrl(false), 1000);
                }}
                className="shrink-0 text-[10px] font-mono text-[#4a6a58] hover:text-[#00e5a0] transition-none"
                title="Copier le lien"
              >
                {copiedUrl ? "Copié !" : "🔗"}
              </button>
            )}
          </div>
        )}

        {/* URL input (idle or extracting) */}
        {(step === "idle" || step === "extracting") && (
          <div className="space-y-3">
            <UrlInput
              value={url}
              onChange={setUrl}
              onSubmit={handleExtract}
              isLoading={step === "extracting"}
              error={error}
              manualText={manualText}
              onManualChange={setManualText}
              onManualSubmit={handleManualSubmit}
            />
            {step === "extracting" && (
              <p className="text-[12px] font-mono text-[#4a6a58]">Extraction du transcript…</p>
            )}
          </div>
        )}

        {/* Empty state */}
        {step === "idle" && !url && (
          <div className="py-16 text-center space-y-3">
            <p className="text-[13px] font-mono text-[#4a6a58]">
              Colle une URL pour commencer
            </p>
            <p className="text-[11px] font-mono text-[#223a2f]">
              YouTube · TikTok · Instagram  ·  ⌘K pour les actions rapides
            </p>
          </div>
        )}

        {/* Transcript card (collapsable) */}
        {(step === "transcript" || step === "rewriting" || step === "done") && transcriptText && (
          <details className="group bg-[#0d1512] border border-[#1a2e25] overflow-hidden" style={{ borderRadius: "4px" }}>
            <summary className="flex items-center justify-between px-4 py-2.5 cursor-pointer list-none select-none hover:bg-[#121f19] transition-none">
              <span className="text-[10px] font-mono font-semibold text-[#8aaa98] tracking-widest uppercase flex items-center gap-2">
                <span className="group-open:rotate-90 inline-block transition-none">▸</span>
                Transcript · {transcriptText.trim().split(/\s+/).filter(Boolean).length} mots
              </span>
              <button
                onClick={async (e) => {
                  e.preventDefault();
                  await navigator.clipboard.writeText(transcriptText);
                  setCopiedTranscript(true);
                  toast.success("Transcript copié");
                  setTimeout(() => setCopiedTranscript(false), 1500);
                }}
                className="text-[10px] font-mono text-[#4a6a58] hover:text-[#00e5a0] transition-none"
              >
                {copiedTranscript ? "Copié !" : "Copier"}
              </button>
            </summary>
            <p className="px-4 py-3 text-[12px] text-[#8aaa98] font-mono whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto border-t border-[#1a2e25]">
              {transcriptText}
            </p>
          </details>
        )}

        {/* CTA choice — asked once per generation, before rewrite */}
        {showCtaChoice && step === "transcript" && (
          <div className="bg-[#0d1512] border border-[#1a2e25] p-4 space-y-3" style={{ borderRadius: "4px" }}>
            <p className="text-[10px] font-mono font-semibold text-[#8aaa98] tracking-widest uppercase">
              CTA de Ronaldo ?
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => chooseCta("none")}
                className="px-3 py-1.5 text-[11px] font-mono border border-[#1a2e25] text-[#8aaa98] hover:border-[#00e5a0] hover:text-[#00e5a0] transition-none"
                style={{ borderRadius: "4px" }}
              >
                Sans CTA
              </button>
              <button
                onClick={() => chooseCta("p3")}
                className="px-3 py-1.5 text-[11px] font-mono border border-[#1a2e25] text-[#8aaa98] hover:border-[#00e5a0] hover:text-[#00e5a0] transition-none"
                style={{ borderRadius: "4px" }}
              >
                CTA Phrase 3
              </button>
              <button
                onClick={() => chooseCta("p4")}
                className="px-3 py-1.5 text-[11px] font-mono border border-[#1a2e25] text-[#8aaa98] hover:border-[#00e5a0] hover:text-[#00e5a0] transition-none"
                style={{ borderRadius: "4px" }}
              >
                CTA Phrase 4
              </button>
            </div>
          </div>
        )}

        {/* Rewriting — streaming preview + skeleton cards */}
        {step === "rewriting" && (
          <div className="space-y-6">
            <div className="bg-[#0d1512] border border-[#1a2e25] p-4 space-y-2" style={{ borderRadius: "4px" }}>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#F59E0B] animate-pulse" />
                <span className="text-[10px] font-mono text-[#4a6a58] tracking-widest uppercase">Réécriture en cours…</span>
              </div>
              {qrText && (
                <p className="text-[12px] font-mono text-[#8aaa98] whitespace-pre-wrap leading-relaxed line-clamp-6">
                  {qrText}
                </p>
              )}
            </div>
            {/* Skeleton script cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              {["FR", "EN", "DE", "ES"].map((lang) => (
                <div key={lang} className="bg-[#0d1512] border border-[#1a2e25] overflow-hidden flex flex-col" style={{ borderRadius: "4px" }}>
                  <div className="h-[2px] w-full" style={{ background: "linear-gradient(90deg, #00e5a0, #ff3cac)" }} />
                  <div className="px-3 py-2 border-b border-[#1a2e25] flex items-center gap-2">
                    <div className="h-2.5 w-16 bg-[#1a2e25] animate-pulse" style={{ borderRadius: "2px" }} />
                    <div className="h-2 w-12 bg-[#121f19] animate-pulse" style={{ borderRadius: "2px" }} />
                  </div>
                  <div className="px-3 py-3 space-y-2 flex-1">
                    {[100, 90, 95, 80, 70].map((w, i) => (
                      <div key={i} className="h-3 bg-[#121f19] animate-pulse" style={{ borderRadius: "2px", width: `${w}%` }} />
                    ))}
                  </div>
                  <div className="px-3 py-2 border-t border-[#1a2e25]">
                    <div className="h-2 w-8 bg-[#121f19] animate-pulse" style={{ borderRadius: "2px" }} />
                  </div>
                </div>
              ))}
            </div>
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
              customSeconds={customSeconds}
              onCustomSecondsChange={setCustomSeconds}
              audio={audio}
              onGenerate={handleGenerateLang}
              onGenerateAll={handleGenerateAll}
              onCopyAllQR={copyAllQR}
              disabled={isLoading}
            />

            {/* Script cards — grid 4-col on md+ */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              {SCRIPT_SECTIONS.map((section) => {
                const content = getContent(section);
                if (!content && !sections[section]) return null;
                const lang = section.split(" ")[1];
                const rawContent = content ?? "";
                const displayContent = ctaEnabled ? insertCTA(rawContent, lang, ctaPosition) : rawContent;
                const stats = displayContent ? wordStats(displayContent) : null;
                const audioKey = provider === "edge-tts" ? `EDGE_${lang}` : provider === "google-tts" ? `GTTS_${lang}` : provider === "google-ai-studio" ? `GEMINI_${lang}` : lang;
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
                    isAutoCorrection={!!correctingLangs[lang]}
                    onCopy={() => copySection(section, displayContent)}
                    onAdjust={(dur) => handleAdjust(section, dur)}
                    onAdjustCustom={(sec) => handleAdjustCustom(section, sec)}
                    onRestore={() => setOverrides((o) => { const n = { ...o }; delete n[section]; return n; })}
                    healthScore={healthScores[lang]?.score}
                    healthFeedback={healthScores[lang]?.feedback}
                  />
                );
              })}
            </div>

            {/* Other sections (keywords, hashtags) */}
            <div className="space-y-3">
              {(SECTIONS.filter((s) => !SCRIPT_SECTIONS.includes(s as Section)) as Section[]).map((section) => {
                const content = getContent(section);
                if (!content && !sections[section]) return null;
                const raw = content ?? "";
                const displayContent = section === "SEARCH KEYWORDS EN" ? filterKeywords(raw) : raw;
                return (
                  <div key={section} className="bg-[#0d1512] border border-[#1a2e25] overflow-hidden" style={{ borderRadius: "4px" }}>
                    <div className="h-[2px] w-full" style={{ background: "linear-gradient(90deg, #00e5a0, #ff3cac)" }} />
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1a2e25]">
                      <span className="text-[10px] font-mono font-semibold text-[#8aaa98] tracking-widest uppercase">
                        {section}
                      </span>
                      <button
                        onClick={() => copySection(section, displayContent)}
                        className="text-[10px] font-mono text-[#4a6a58] hover:text-[#00e5a0] transition-none"
                      >
                        {copied === section ? "Copié ✓" : "Copier"}
                      </button>
                    </div>
                    <p className="px-4 py-3 text-[13px] font-mono text-[#e0f0e8] whitespace-pre-wrap leading-relaxed">
                      {displayContent}
                    </p>
                  </div>
                );
              })}
            </div>

          </div>
        )}
      </main>

      <footer className="text-center text-[#1a2e25] text-[10px] font-mono py-6 mt-8">
        DAV Pipeline · 2026
      </footer>

      {/* Command palette */}
      <CommandPalette
        open={showPalette}
        onClose={() => setShowPalette(false)}
        onPasteUrl={() => { reset(); setTimeout(() => { const el = document.querySelector("input[type=text]") as HTMLInputElement; el?.focus(); }, 50); }}
        onGenerateFR={() => { const c = getVoiceConfigForLang("FR"); handleTTS("FR", c.voice, c.speed); }}
        onGenerateEN={() => { const c = getVoiceConfigForLang("EN"); handleTTS("EN", c.voice, c.speed); }}
        onGenerateDE={() => { const c = getVoiceConfigForLang("DE"); handleTTS("DE", c.voice, c.speed); }}
        onGenerateES={() => { const c = getVoiceConfigForLang("ES"); handleTTS("ES", c.voice, c.speed); }}
        onGenerateAll={handleGenerateAll}
        onCopyAllQR={() => { copyAllQR(); toast.success("QR copié !"); }}
        onReset={reset}
        hasContent={step === "done"}
      />

      {/* Floating actions (mobile) */}
      <FloatingActions onCopyAllQR={() => { copyAllQR(); }} show={step === "done"} />

        </>
      )}
    </div>
  );
}

