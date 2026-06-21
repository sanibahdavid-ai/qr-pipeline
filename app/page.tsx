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
import { EDGE_TTS_VOICES } from "../lib/edge-tts-voices";
import { GOOGLE_TTS_VOICES } from "../lib/google-tts-voices";
import { sanitizeTitle, wordStats } from "../lib/format";
import type { Provider, Section, AudioState, Step, HistoryEntry, AuthUser } from "../types";
import { SECTIONS } from "../types";
import { supabase } from "../lib/supabase";
import type { GenerationRow } from "../lib/supabase";

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
  useHotkeys("1", () => { const a = audio["FR"] ?? audio["EDGE_FR"] ?? audio["GTTS_FR"]; if (a?.audioUrl) playAudio(a.audioUrl); }, { enabled: step === "done" });
  useHotkeys("2", () => { const a = audio["EN"] ?? audio["EDGE_EN"] ?? audio["GTTS_EN"]; if (a?.audioUrl) playAudio(a.audioUrl); }, { enabled: step === "done" });
  useHotkeys("3", () => { const a = audio["DE"] ?? audio["EDGE_DE"] ?? audio["GTTS_DE"]; if (a?.audioUrl) playAudio(a.audioUrl); }, { enabled: step === "done" });
  useHotkeys("4", () => { const a = audio["ES"] ?? audio["EDGE_ES"] ?? audio["GTTS_ES"]; if (a?.audioUrl) playAudio(a.audioUrl); }, { enabled: step === "done" });

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
    // Skip the intermediate transcript step — go straight to rewriting
    await handleRewrite(data.text, data.title);
  }

  // ── Manual transcript ───────────────────────────────────────────────────────
  // Paste text directly and skip URL extraction — go straight to rewriting.
  async function handleManualSubmit() {
    const text = manualText.trim();
    if (!text || isLoading) return;
    setError("");
    setQrText("");
    const title = "Transcript manuel";
    setVideoTitle(title);
    setTranscriptText(text);
    await handleRewrite(text, title);
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
  async function handleTTS(language: "EN" | "DE" | "FR" | "ES", voice: string, speed: number, modelId?: string) {
    const sectionKey = `SCRIPT ${language}` as Section;
    const rawText = getContent(sectionKey);
    console.log(`[handleTTS] lang=${language} sectionKey=${sectionKey} textLength=${rawText?.length ?? 0} step=${step}`);
    if (!rawText) return;
    const text = ctaEnabled ? insertCTA(rawText, language, ctaPosition) : rawText;

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

    if (provider === "elevenlabs") {
      setAudio((a) => ({ ...a, [language]: { status: "loading", label: "Envoi..." } }));
      try {
        const res = await fetch("/api/tts/elevenlabs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, model_id: modelId }),
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

  function handleGenerateLang(lang: "FR" | "EN" | "DE" | "ES", voice: string, speed: number, modelId?: string) {
    handleTTS(lang, voice, speed, modelId);
  }

  async function handleGenerateAll() {
    const raw = typeof window !== "undefined" ? localStorage.getItem("qr_voice_config_v5") : null;
    const configs = raw ? JSON.parse(raw) : {};

    function getVoiceConfig(lang: string) {
      const key = `${provider}__${lang}`;
      return configs[key] ?? getDefaultVoiceConfig(provider, lang);
    }

    function getModelId(lang: string): string | undefined {
      try { return localStorage.getItem(`el_model_${lang}`) ?? undefined; } catch { return undefined; }
    }

    await Promise.allSettled([
      handleTTS("FR", getVoiceConfig("FR").voice, getVoiceConfig("FR").speed, getModelId("FR")),
      handleTTS("EN", getVoiceConfig("EN").voice, getVoiceConfig("EN").speed, getModelId("EN")),
      handleTTS("DE", getVoiceConfig("DE").voice, getVoiceConfig("DE").speed, getModelId("DE")),
      handleTTS("ES", getVoiceConfig("ES").voice, getVoiceConfig("ES").speed, getModelId("ES")),
    ]);
  }

  function getDefaultVoiceConfig(p: Provider, lang: string): { voice: string; speed: number } {
    const defaults: Record<string, Record<string, { voice: string; speed: number }>> = {
      "ai33-minimax":    { FR: { voice: "clone_2580971", speed: 1.0 }, EN: { voice: "clone_2608233", speed: 1.0 }, DE: { voice: "clone_2608233", speed: 1.0 }, ES: { voice: "clone_2608233", speed: 1.0 } },
      "ai33-elevenlabs": { FR: { voice: "elevenlabs_CwhRBWXzGAHq8TQ4Fs17", speed: 1.0 }, EN: { voice: "elevenlabs_CwhRBWXzGAHq8TQ4Fs17", speed: 1.0 }, DE: { voice: "elevenlabs_CwhRBWXzGAHq8TQ4Fs17", speed: 1.0 }, ES: { voice: "elevenlabs_JBFqnCBsd6RMkjVDRZzb", speed: 1.0 } },
      "elevenlabs":      { FR: { voice: "aTTiK3YzK3dXETpuDE2h", speed: 1.0 }, EN: { voice: "aTTiK3YzK3dXETpuDE2h", speed: 1.0 }, DE: { voice: "aTTiK3YzK3dXETpuDE2h", speed: 1.0 }, ES: { voice: "aTTiK3YzK3dXETpuDE2h", speed: 1.0 } },
      "edge-tts":        { FR: { voice: "fr-FR-HenriNeural", speed: 0 }, EN: { voice: "en-US-GuyNeural", speed: 0 }, DE: { voice: "de-DE-KillianNeural", speed: 0 }, ES: { voice: "es-ES-AlvaroNeural", speed: 0 } },
      "google-tts":      { FR: { voice: "fr-FR-Neural2-B", speed: 1.0 }, EN: { voice: "en-US-Neural2-D", speed: 1.0 }, DE: { voice: "de-DE-Neural2-B", speed: 1.0 }, ES: { voice: "es-ES-Neural2-B", speed: 1.0 } },
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
    const raw = typeof window !== "undefined" ? localStorage.getItem("qr_voice_config_v5") : null;
    const configs = raw ? (JSON.parse(raw) as Record<string, { voice: string; speed: number }>) : {};
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

            {/* Generation panel — temporarily hidden */}
            {false && (
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
            )}

            {/* Script cards — grid 4-col on md+ */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              {SCRIPT_SECTIONS.map((section) => {
                const content = getContent(section);
                if (!content && !sections[section]) return null;
                const lang = section.split(" ")[1];
                const rawContent = content ?? "";
                const displayContent = ctaEnabled ? insertCTA(rawContent, lang, ctaPosition) : rawContent;
                const stats = displayContent ? wordStats(displayContent) : null;
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

