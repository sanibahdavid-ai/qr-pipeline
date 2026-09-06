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
import { GEMINI_STYLE_DEFAULT, GEMINI_PACE_DEFAULT, GEMINI_ACCENT_DEFAULT } from "../lib/gemini-tts-voices";
import { sanitizeTitle, wordStats } from "../lib/format";
import type { Provider, Section, AudioState, Step, HistoryEntry, AuthUser, UserRole } from "../types";
import { SECTIONS } from "../types";
import { supabase } from "../lib/supabase";
import type { GenerationRow } from "../lib/supabase";
import { VOICE_CONFIG_STORAGE_KEY, type VoiceConfig } from "../hooks/useVoiceConfig";

// ── Constants ─────────────────────────────────────────────────────────────────
const SCRIPT_SECTIONS: Section[] = ["SCRIPT FR", "SCRIPT EN", "SCRIPT DE", "SCRIPT ES"];

const RONALDO_CTA_TEXTS: Record<string, string> = {
  FR: "En passant, savais-tu que Cristiano sourit quand tu tapes sur le bouton plus ?",
  EN: "By the way, did you know Cristiano smiles when you tap the plus button?",
  DE: "Übrigens, wusstest du, dass Cristiano lächelt, wenn du auf Plus tippst?",
  ES: "Por cierto, ¿sabías que Cristiano sonríe cuando tocas el botón plus?",
};

const TIKTOK_CTA_TEXTS: Record<string, string> = {
  FR: "Si tu es fan de ce genre d'histoires football, suis-nous dès maintenant, car TikTok risque de ne plus te montrer notre prochain chef-d'œuvre si tu ne le fais pas.",
  EN: "If you're impressed by football stories like this one, follow us right now, because TikTok might not show you our next masterpiece if you don't.",
  DE: "Wenn dir solche Fußball-Geschichten gefallen, folge uns jetzt, denn TikTok könnte dir unser nächstes Meisterwerk sonst nicht mehr zeigen.",
  ES: "Si te gustan este tipo de historias del fútbol, síguenos ahora mismo, porque TikTok podría no mostrarte nuestra próxima obra maestra si no lo haces.",
};

type CtaChoice = "none" | "ronaldo" | "tiktok";

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

function splitSentences(text: string): string[] {
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
  return parts;
}

// Calls Claude to find the narratively best placement for the CTA, with a
// local fallback (30% for Ronaldo, 80% for TikTok) if the API call fails.
async function placeCta(script: string, lang: string, ctaType: "ronaldo" | "tiktok"): Promise<string> {
  const ctaText = (ctaType === "ronaldo" ? RONALDO_CTA_TEXTS : TIKTOK_CTA_TEXTS)[lang];
  if (!ctaText || !script.trim()) return script;
  const sentences = splitSentences(script);
  if (sentences.length < 3) return `${script.trim()} ${ctaText}`;

  const fallback = () => Math.round(sentences.length * (ctaType === "ronaldo" ? 0.3 : 0.8)) - 1;

  let index: number;
  try {
    const res = await fetch("/api/place-cta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script, ctaType, ctaText }),
    });
    if (!res.ok) throw new Error("bad status");
    const data = await res.json();
    const parsed = Number(data.insertAfterSentenceIndex);
    index = Number.isFinite(parsed) ? parsed : fallback();
  } catch {
    index = fallback();
  }

  const bounded = Math.max(1, Math.min(index, sentences.length - 2));
  return [...sentences.slice(0, bounded + 1), ctaText, ...sentences.slice(bounded + 1)].join(" ");
}
const ADJUST_DURATIONS = ["10s", "15s", "30s", "45s", "1min30", "2min"] as const;
type AdjustDuration = (typeof ADJUST_DURATIONS)[number];

const HISTORY_KEY = "qr_pipeline_history";
const MAX_HISTORY = 50;
const TAB_KEY = "dav_active_tab";
const AUDIO_ENABLED_KEY = "dav_audio_enabled";
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

  // Hidden audio toggle (blue dot) — gates all TTS generation, everywhere
  const [audioEnabled, setAudioEnabled] = useState(false);

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

  // PIN Auth
  const [pinRole, setPinRole] = useState<UserRole>(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState("");

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
      const savedTab = localStorage.getItem(TAB_KEY) as Tab | null;
      if (savedTab === "scripts" || savedTab === "download") setActiveTab(savedTab);
      if (localStorage.getItem(AUDIO_ENABLED_KEY) === "1") setAudioEnabled(true);
      const savedPinRole = localStorage.getItem("dav_pin_role") as UserRole | null;
      if (savedPinRole) setPinRole(savedPinRole);
      else setShowPinModal(true);
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
        const storedRole = localStorage.getItem("dav_pin_role") as UserRole | null;
        if (!storedRole) setShowPinModal(true);
        else loadCloudHistory(data.user.id, storedRole);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u as AuthUser | null);
      if (u) {
        const storedRole = localStorage.getItem("dav_pin_role") as UserRole | null;
        if (!storedRole) setShowPinModal(true);
        else loadCloudHistory(u.id, storedRole);
      }
      else {
        setCloudHistory([]);
        setPinRole(null);
        localStorage.removeItem("dav_pin_role");
      }
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
  async function loadCloudHistory(userId?: string, role?: UserRole) {
    if (!supabase) return;
    const activeUserId = userId ?? user?.id;
    const activeRole = role ?? pinRole;
    if (!activeUserId || !activeRole) return;

    let query = supabase.from("generations").select("*").order("created_at", { ascending: false }).limit(50);
    
    // Si ce n'est pas le DAV (Directeur), on limite aux vidéos de l'utilisateur
    if (activeRole !== "DAV") {
      query = query.eq("user_id", activeUserId);
    }

    const { data } = await query;
    if (data) setCloudHistory(data as GenerationRow[]);
  }

  function handlePinSubmit(e: React.FormEvent) {
    e.preventDefault();
    let newRole: UserRole = null;
    if (pinInput === "2811") newRole = "DAV";
    else if (pinInput === "0000") newRole = "ADMIN";
    else if (pinInput === "1234") newRole = "GUEST";
    
    if (newRole) {
      setPinRole(newRole);
      localStorage.setItem("dav_pin_role", newRole);
      setShowPinModal(false);
      setPinInput("");
      if (user) loadCloudHistory(user.id, newRole);
      toast.success(`Connecté en tant que ${newRole === "DAV" ? "DAV (Directeur)" : newRole === "ADMIN" ? "Admin" : "Invité"}`);
    } else {
      toast.error("Code PIN incorrect");
      setPinInput("");
    }
  }

  function handlePinLogout() {
    setPinRole(null);
    localStorage.removeItem("dav_pin_role");
    setShowPinModal(true);
    setPinInput("");
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
  function chooseCta(choice: CtaChoice) {
    setShowCtaChoice(false);
    if (pendingRewrite) {
      const { text, title } = pendingRewrite;
      setPendingRewrite(null);
      void handleRewrite(text, title, choice);
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

  async function applyCtaToScripts(parsed: Partial<Record<Section, string>>, ctaChoice: "ronaldo" | "tiktok") {
    const entries: Array<[Section, string]> = [
      ["SCRIPT FR", "FR"],
      ["SCRIPT EN", "EN"],
      ["SCRIPT DE", "DE"],
      ["SCRIPT ES", "ES"],
    ];
    await Promise.all(
      entries.map(async ([section, lang]) => {
        const script = parsed[section];
        if (!script) return;
        const withCta = await placeCta(script, lang, ctaChoice);
        setOverrides((o) => ({ ...o, [section]: withCta }));
      })
    );
  }

  async function handleRewrite(text: string, title?: string, ctaChoice: CtaChoice = "none") {
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
    if (ctaChoice !== "none") {
      void applyCtaToScripts(parsed, ctaChoice);
    }
  }

  // ── TTS ───────────────────────────────────────────────────────────────────
  async function handleTTS(language: "EN" | "DE" | "FR" | "ES", voice: string, speed: number, modelId?: string, geminiParams?: { style: string; pace: string; accent: string }) {
    if (!audioEnabled) return;
    if (pinRole === "ADMIN") { toast.error("Génération vocale non disponible pour le profil Admin"); return; }
    const sectionKey = `SCRIPT ${language}` as Section;
    const text = getContent(sectionKey);
    if (!text) return;

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
    if (!audioEnabled) return;
    if (pinRole === "ADMIN") { toast.error("Génération vocale non disponible pour le profil Admin"); return; }
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

  function toggleAudioEnabled() {
    setAudioEnabled((v) => {
      const next = !v;
      try { localStorage.setItem(AUDIO_ENABLED_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  }

  function switchTab(tab: Tab) {
    setActiveTab(tab);
    try { localStorage.setItem(TAB_KEY, tab); } catch {}
  }

  // ── Render ────────────────────────────────────────────────────────────────
  // Si pas de rôle, on affiche uniquement la fenêtre du code PIN
  if (!pinRole) {
    return (
      <div className="min-h-screen bg-[#060a12] text-[#e0eef8] flex items-center justify-center">
        <div className="bg-[#0d1420] border border-[#1a2942] p-8 w-[360px] shadow-2xl" style={{ borderRadius: "8px" }}>
          <div className="h-[2px] w-full mb-6" style={{ background: "linear-gradient(90deg, #00b4ff, #ff3cac)" }} />
          <h2
            className="text-[18px] font-bold tracking-tight text-center mb-1"
            style={{
              fontFamily: "var(--font-syne)",
              background: "linear-gradient(135deg, #00b4ff, #ff3cac)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            DAV PIPELINE
          </h2>
          <p className="text-[11px] font-mono text-[#4a6a8a] text-center mb-6">Entrez votre code d&apos;accès</p>
          <form onSubmit={handlePinSubmit} className="space-y-4">
            <input
              type="password"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              autoFocus
              className="w-full bg-[#13233a] border border-[#1a2942] text-center text-[28px] font-mono text-[#e0eef8] py-4 focus:outline-none focus:border-[#00b4ff] tracking-[0.5em]"
              style={{ borderRadius: "4px" }}
              placeholder="••••"
            />
            <button
              type="submit"
              className="w-full py-2.5 bg-[#00b4ff] text-black font-mono text-[12px] font-bold hover:bg-[#33c3ff] transition-colors"
              style={{ borderRadius: "4px" }}
            >
              Connexion
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#060a12] text-[#e0eef8] relative z-[1]">
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
        audioEnabled={audioEnabled}
        onAudioToggle={toggleAudioEnabled}
        user={user}
        cloudHistory={cloudHistory}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onRestoreCloud={restoreFromCloudHistory}
        pinRole={pinRole}
        onPinLogout={handlePinLogout}
      />

      {/* Tab switcher */}
      <div style={{ borderBottom: "1px solid #1a2942" }}>
        <div className="max-w-5xl mx-auto px-4 flex">
          {(["scripts", "download"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => switchTab(tab)}
              className="px-4 py-2.5 text-[11px] font-mono font-semibold tracking-widest uppercase transition-none"
              style={{
                color: activeTab === tab ? "#00b4ff" : "#4a6a8a",
                borderBottom: activeTab === tab ? "2px solid #00b4ff" : "2px solid transparent",
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
            <p className="text-[12px] font-mono text-[#4a6a8a] truncate min-w-0 flex-1">
              <span className="text-[#2a4a75]">▸ </span>{videoTitle}
            </p>
            {url && (
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(url);
                  setCopiedUrl(true);
                  setTimeout(() => setCopiedUrl(false), 1000);
                }}
                className="shrink-0 text-[10px] font-mono text-[#4a6a8a] hover:text-[#00b4ff] transition-none"
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
              <p className="text-[12px] font-mono text-[#4a6a8a]">Extraction du transcript…</p>
            )}
          </div>
        )}

        {/* Empty state */}
        {step === "idle" && !url && (
          <div className="py-16 text-center space-y-3">
            <p className="text-[13px] font-mono text-[#4a6a8a]">
              Colle une URL pour commencer
            </p>
            <p className="text-[11px] font-mono text-[#2a4a75]">
              YouTube · TikTok · Instagram  ·  ⌘K pour les actions rapides
            </p>
          </div>
        )}

        {/* Transcript card (collapsable) */}
        {(step === "transcript" || step === "rewriting" || step === "done") && transcriptText && (
          <details className="group bg-[#0d1420] border border-[#1a2942] overflow-hidden" style={{ borderRadius: "4px" }}>
            <summary className="flex items-center justify-between px-4 py-2.5 cursor-pointer list-none select-none hover:bg-[#13233a] transition-none">
              <span className="text-[10px] font-mono font-semibold text-[#7a9ac2] tracking-widest uppercase flex items-center gap-2">
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
                className="text-[10px] font-mono text-[#4a6a8a] hover:text-[#00b4ff] transition-none"
              >
                {copiedTranscript ? "Copié !" : "Copier"}
              </button>
            </summary>
            <p className="px-4 py-3 text-[12px] text-[#7a9ac2] font-mono whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto border-t border-[#1a2942]">
              {transcriptText}
            </p>
          </details>
        )}

        {/* CTA choice — asked once per generation, before rewrite */}
        {showCtaChoice && step === "transcript" && (
          <div className="bg-[#0d1420] border border-[#1a2942] p-4 space-y-3" style={{ borderRadius: "4px" }}>
            <p className="text-[10px] font-mono font-semibold text-[#7a9ac2] tracking-widest uppercase">
              CTA ?
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => chooseCta("none")}
                className="px-3 py-1.5 text-[11px] font-mono border border-[#1a2942] text-[#7a9ac2] hover:border-[#00b4ff] hover:text-[#00b4ff] transition-none"
                style={{ borderRadius: "4px" }}
              >
                Sans CTA
              </button>
              {pinRole !== "GUEST" && (
                <>
                  <button
                    onClick={() => chooseCta("ronaldo")}
                    className="px-3 py-1.5 text-[11px] font-mono border border-[#1a2942] text-[#7a9ac2] hover:border-[#00b4ff] hover:text-[#00b4ff] transition-none"
                    style={{ borderRadius: "4px" }}
                  >
                    CTA Ronaldo
                  </button>
                  <button
                    onClick={() => chooseCta("tiktok")}
                    className="px-3 py-1.5 text-[11px] font-mono border border-[#1a2942] text-[#7a9ac2] hover:border-[#00b4ff] hover:text-[#00b4ff] transition-none"
                    style={{ borderRadius: "4px" }}
                  >
                    CTA TikTok Follow
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Rewriting — streaming preview + skeleton cards */}
        {step === "rewriting" && (
          <div className="space-y-6">
            <div className="bg-[#0d1420] border border-[#1a2942] p-4 space-y-2" style={{ borderRadius: "4px" }}>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#F59E0B] animate-pulse" />
                <span className="text-[10px] font-mono text-[#4a6a8a] tracking-widest uppercase">Réécriture en cours…</span>
              </div>
              {qrText && (
                <p className="text-[12px] font-mono text-[#7a9ac2] whitespace-pre-wrap leading-relaxed line-clamp-6">
                  {qrText}
                </p>
              )}
            </div>
            {/* Skeleton script cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              {["FR", "EN", "DE", "ES"].map((lang) => (
                <div key={lang} className="bg-[#0d1420] border border-[#1a2942] overflow-hidden flex flex-col" style={{ borderRadius: "4px" }}>
                  <div className="h-[2px] w-full" style={{ background: "linear-gradient(90deg, #00b4ff, #ff3cac)" }} />
                  <div className="px-3 py-2 border-b border-[#1a2942] flex items-center gap-2">
                    <div className="h-2.5 w-16 bg-[#1a2942] animate-pulse" style={{ borderRadius: "2px" }} />
                    <div className="h-2 w-12 bg-[#13233a] animate-pulse" style={{ borderRadius: "2px" }} />
                  </div>
                  <div className="px-3 py-3 space-y-2 flex-1">
                    {[100, 90, 95, 80, 70].map((w, i) => (
                      <div key={i} className="h-3 bg-[#13233a] animate-pulse" style={{ borderRadius: "2px", width: `${w}%` }} />
                    ))}
                  </div>
                  <div className="px-3 py-2 border-t border-[#1a2942]">
                    <div className="h-2 w-8 bg-[#13233a] animate-pulse" style={{ borderRadius: "2px" }} />
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
              audioEnabled={audioEnabled}
            />

            {/* Script cards — grid 4-col on md+ */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              {SCRIPT_SECTIONS.map((section) => {
                const content = getContent(section);
                if (!content && !sections[section]) return null;
                const lang = section.split(" ")[1];
                const displayContent = content ?? "";
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
                  <div key={section} className="bg-[#0d1420] border border-[#1a2942] overflow-hidden" style={{ borderRadius: "4px" }}>
                    <div className="h-[2px] w-full" style={{ background: "linear-gradient(90deg, #00b4ff, #ff3cac)" }} />
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1a2942]">
                      <span className="text-[10px] font-mono font-semibold text-[#7a9ac2] tracking-widest uppercase">
                        {section}
                      </span>
                      <button
                        onClick={() => copySection(section, displayContent)}
                        className="text-[10px] font-mono text-[#4a6a8a] hover:text-[#00b4ff] transition-none"
                      >
                        {copied === section ? "Copié ✓" : "Copier"}
                      </button>
                    </div>
                    <p className="px-4 py-3 text-[13px] font-mono text-[#e0eef8] whitespace-pre-wrap leading-relaxed">
                      {displayContent}
                    </p>
                  </div>
                );
              })}
            </div>

          </div>
        )}
      </main>

      <footer className="text-center text-[#1a2942] text-[10px] font-mono py-6 mt-8 flex items-center justify-center gap-2">
        <span>DAV Pipeline · 2026</span>
        {/* Point d'accès caché vers Clone Script Pipeline — invisible, pas de lien nav */}
        <a
          href="/csp"
          tabIndex={-1}
          aria-hidden="true"
          className="w-2 h-2 shrink-0 rounded-full"
          style={{ background: "transparent" }}
        />
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

