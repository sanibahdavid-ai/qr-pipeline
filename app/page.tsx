"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import { AudioLines, Check, ChevronRight, Copy, Link2, Loader2, RotateCcw, Wrench } from "lucide-react";
import { Header, TabSwitch, APP_VERSION } from "../components/Header";
import { UrlInput } from "../components/UrlInput";
import { GenerationPanel } from "../components/GenerationPanel";
import { ScriptCard } from "../components/ScriptCard";
import { CommandPalette } from "../components/CommandPalette";
import { FloatingActions } from "../components/FloatingActions";
import { EDGE_TTS_VOICES } from "../lib/edge-tts-voices";
import { GOOGLE_TTS_VOICES } from "../lib/google-tts-voices";
import { GEMINI_STYLE_DEFAULT, GEMINI_PACE_DEFAULT, GEMINI_ACCENT_DEFAULT } from "../lib/gemini-tts-voices";
import { sanitizeTitle, wordStats } from "../lib/format";
import { RONALDO_CTA_TEXTS, TIKTOK_CTA_TEXTS, splitSentences, stripCtaSentences, dedupeCta, scriptContainsCta } from "../lib/cta";
import type { Provider, Section, AudioState, Step, HistoryEntry, AuthUser, UserRole } from "../types";
import { SECTIONS } from "../types";
import { supabase } from "../lib/supabase";
import type { GenerationRow } from "../lib/supabase";
import { VOICE_CONFIG_STORAGE_KEY, clampSpeed, type VoiceConfig } from "../hooks/useVoiceConfig";

// ── Constants ─────────────────────────────────────────────────────────────────
const SCRIPT_SECTIONS: Section[] = ["SCRIPT FR", "SCRIPT EN", "SCRIPT DE", "SCRIPT ES"];

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

function sanitizeTitles(parsed: Partial<Record<Section, string>>): void {
  const nonFrTitleSections: Section[] = [
    "TITRE ET HASHTAGS EN", "TITRE ET HASHTAGS DE", "TITRE ET HASHTAGS ES",
    "TITRE ET HASHTAGS EN B", "TITRE ET HASHTAGS DE B", "TITRE ET HASHTAGS ES B",
  ];
  for (const s of nonFrTitleSections) {
    if (parsed[s]) parsed[s] = parsed[s]!.replace(/\s+([!?])/g, "$1");
  }
}

// Calls Claude to find the narratively best placement for the CTA, with a
// local fallback (25-45% of sentences for Ronaldo, 75-90% for TikTok) if the API call fails.
// Idempotent: any CTA already in the script — one the model wrote itself, or
// one carried in from an earlier pass (adjust feeds back the CTA'd text) — is
// removed first, so exactly one is ever inserted.
async function placeCta(rawScript: string, lang: string, ctaType: "ronaldo" | "tiktok"): Promise<string> {
  const ctaText = (ctaType === "ronaldo" ? RONALDO_CTA_TEXTS : TIKTOK_CTA_TEXTS)[lang];
  const script = stripCtaSentences(rawScript);
  if (!ctaText || !script.trim()) return script;

  // Last-resort guard: stripCtaSentences only removes a CTA that stands as its
  // own short sentence. If a rewrite (e.g. /api/adjust) folded a paraphrased
  // CTA into a longer narrative sentence, it survives stripping undetected —
  // check the whole script for the CTA's keyword signature before inserting
  // a second one, and skip insertion rather than duplicate it.
  if (scriptContainsCta(script)) {
    console.warn(`[placeCta] ${ctaType} CTA-like text already present in ${lang} script, skipping insertion`);
    return script;
  }

  const sentences = splitSentences(script);
  if (sentences.length < 3) return dedupeCta(`${script.trim()} ${ctaText}`);

  const fallback = () => {
    const [lo, hi] = ctaType === "ronaldo" ? [0.25, 0.45] : [0.75, 0.9];
    const minIndex = Math.ceil(sentences.length * lo);
    const maxIndex = Math.floor(sentences.length * hi);
    return Math.round((minIndex + maxIndex) / 2) - 1;
  };

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
  return dedupeCta([...sentences.slice(0, bounded + 1), ctaText, ...sentences.slice(bounded + 1)].join(" "));
}
const ADJUST_DURATIONS = ["10s", "15s", "30s", "45s", "1min30", "2min"] as const;
type AdjustDuration = (typeof ADJUST_DURATIONS)[number];

const DURATION_LABELS: Record<AdjustDuration, string> = {
  "10s": "10 s",
  "15s": "15 s",
  "30s": "30 s",
  "45s": "45 s",
  "1min30": "1 min 30",
  "2min": "2 min",
};

const CTA_OPTIONS: { id: CtaChoice; title: string; hint: string }[] = [
  { id: "none", title: "Sans CTA", hint: "Les scripts seuls" },
  { id: "ronaldo", title: "CTA Ronaldo", hint: "Cristiano et le bouton plus, avant le milieu" },
  { id: "tiktok", title: "CTA TikTok", hint: "L'invitation à s'abonner, vers la fin" },
];

const TITLE_SHORT: Array<[Section, string]> = [
  ["TITRE ET HASHTAGS FR", "FR"],
  ["TITRE ET HASHTAGS EN", "EN"],
  ["TITRE ET HASHTAGS DE", "DE"],
  ["TITRE ET HASHTAGS ES", "ES"],
];

const TITLE_LONG: Array<[Section, string]> = [
  ["TITRE ET HASHTAGS FR B", "FR"],
  ["TITRE ET HASHTAGS EN B", "EN"],
  ["TITRE ET HASHTAGS DE B", "DE"],
  ["TITRE ET HASHTAGS ES B", "ES"],
];

const HISTORY_KEY = "qr_pipeline_history";
const MAX_HISTORY = 50;
const TAB_KEY = "dav_active_tab";
type Tab = "scripts" | "download";

// ── Helpers ───────────────────────────────────────────────────────────────────
function cleanContent(raw: string): string {
  return raw
    .replace(/\n*SECTION\s+\d+[^\n]*$/i, "")
    .replace(/\n*Prêt pour le prochain script\s*!?\s*$/i, "")
    .replace(/^\s*\*{0,2}\s*\(?\s*[Cc]ompte\s*:.*mots.*\)?\s*\*{0,2}\s*$/gm, "")
    .replace(/\*\*/g, "")
    .replace(/^-{3,}\s*$/gm, "")
    .replace(/✓/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseQR(text: string): Partial<Record<Section, string>> {
  // Fallback: header names missing, only "SECTION N" markers. Map by number.
  if (!SECTIONS.some((s) => text.includes(s))) {
    const parts = text.split(/^\s*SECTION\s+(\d{1,2})\s*$/m);
    const byNum: Partial<Record<Section, string>> = {};
    for (let i = 1; i + 1 < parts.length; i += 2) {
      const sec = SECTIONS[Number(parts[i]) - 1];
      const content = cleanContent(parts[i + 1].trim());
      if (sec && content) byNum[sec] = content;
    }
    sanitizeTitles(byNum);
    return byNum;
  }
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
  sanitizeTitles(result);
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

  // Director session — password-gated, gates all TTS generation
  const [directorSessionUnlocked, setDirectorSessionUnlocked] = useState(false);

  // Per-generation CTA choice (asked after extraction, before rewrite — not persisted)
  const [showCtaChoice, setShowCtaChoice] = useState(false);
  const [pendingRewrite, setPendingRewrite] = useState<{ text: string; title: string } | null>(null);
  const [activeCtaChoice, setActiveCtaChoice] = useState<CtaChoice>("none");

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
  const [pinNotice, setPinNotice] = useState("");
  const [pinError, setPinError] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);

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
      const savedPinRole = localStorage.getItem("dav_pin_role") as UserRole | null;
      if (savedPinRole) {
        setPinRole(savedPinRole);
        if (savedPinRole === "DAV") {
          setProvider("elevenlabs");
          // Le profil directeur donne l'audio sur n'importe quel appareil : le
          // serveur le reconnaît grâce au cookie posé à la connexion. Si ce cookie
          // manque (session ouverte avant la v6.9, cookies effacés), on redemande
          // le code une fois au lieu de laisser un profil directeur sans audio.
          fetch("/api/director/status")
            .then((r) => r.json())
            .then((d) => {
              if (d?.ok) {
                setDirectorSessionUnlocked(true);
              } else {
                setDirectorSessionUnlocked(false);
                setPinRole(null);
                try { localStorage.removeItem("dav_pin_role"); } catch {}
                setPinNotice("Reconnecte-toi au profil directeur pour réactiver la génération audio.");
                setShowPinModal(true);
              }
            })
            .catch(() => {});
        } else {
          // Un autre profil ne doit garder aucun droit audio sur ce navigateur.
          void fetch("/api/director/logout", { method: "POST" }).catch(() => {});
        }
      } else setShowPinModal(true);
    } catch {}
  }, []);

  useEffect(() => {
    async function backfillTitles() {
      const stale = history.filter(
        (h) =>
          !h.summaryTitle &&
          h.qrText &&
          (h.title === "Vidéo TikTok" || h.title === "Vidéo Instagram" || h.title === "Vidéo YouTube" || h.title === "Transcript manuel" || h.title === "Titre en cours...")
      );
      if (stale.length === 0) return;
      const batch = stale.slice(0, 2);
      for (const entry of batch) {
        try {
          const parsed = parseQR(entry.qrText);
          const frScript = parsed["SCRIPT FR"];
          if (!frScript) continue;
          let summaryTitle = "";
          try {
            const res = await fetch("/api/generate-title", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ script: frScript }),
            });
            if (res.ok) {
              const data = await res.json();
              summaryTitle = data.title ?? "";
            }
          } catch {}
          if (!summaryTitle) summaryTitle = frScript.split(/\s+/).slice(0, 8).join(" ");
          setHistory((prev) => {
            const updated = prev.map((h) => h.id === entry.id ? { ...h, summaryTitle } : h);
            try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)); } catch {}
            return updated;
          });
        } catch {}
      }
    }
    if (history.length > 0) void backfillTitles();
  }, [history.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
        if (storedRole) loadCloudHistory(data.user.id, storedRole);
      }
    }).catch(() => {}); // Supabase being unreachable must not break the app
    // PIN access and Supabase sign-in are independent: Supabase only backs the
    // optional cloud history. Losing a Supabase session (expired token, network,
    // never signed in) must never revoke the PIN and bounce the user to the
    // login screen mid-generation.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u as AuthUser | null);
      if (u) {
        const storedRole = localStorage.getItem("dav_pin_role") as UserRole | null;
        if (storedRole) loadCloudHistory(u.id, storedRole);
      } else {
        setCloudHistory([]);
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

  async function generateSummaryTitle(historyId: string, qrText: string) {
    try {
      const parsed = parseQR(qrText);
      const frScript = parsed["SCRIPT FR"];
      if (!frScript) return;
      let summaryTitle = "";
      try {
        const res = await fetch("/api/generate-title", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ script: frScript }),
        });
        if (res.ok) {
          const data = await res.json();
          summaryTitle = data.title ?? "";
        }
      } catch {}
      if (!summaryTitle) {
        summaryTitle = frScript.split(/\s+/).slice(0, 8).join(" ");
      }
      setVideoTitle(summaryTitle);
      setHistory((prev) => {
        const updated = prev.map((h) => h.id === historyId ? { ...h, summaryTitle } : h);
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)); } catch {}
        return updated;
      });
    } catch {}
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
    setVideoTitle(entry.summaryTitle || entry.title);
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

  async function handlePinSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pinBusy) return;
    setPinBusy(true);
    let newRole: UserRole = null;
    if (pinInput === "2811") newRole = "ADMIN";
    else if (pinInput === "2026") newRole = "GUEST";
    else if (pinInput.length === 4) {
      // The director code is checked on the server, which also sets the cookie
      // the audio routes require.
      try {
        const r = await fetch("/api/director/unlock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: pinInput }),
        });
        if (r.ok) newRole = "DAV";
      } catch {}
    }
    
    setPinBusy(false);
    if (newRole) {
      setPinRole(newRole);
      localStorage.setItem("dav_pin_role", newRole);
      setShowPinModal(false);
      setPinInput("");
      setPinNotice("");
      if (newRole === "DAV") {
        setDirectorSessionUnlocked(true);
        setProvider("elevenlabs");
      } else {
        setDirectorSessionUnlocked(false);
        void fetch("/api/director/logout", { method: "POST" }).catch(() => {});
      }
      if (user) loadCloudHistory(user.id, newRole);
      toast.success(`Connecté au profil ${newRole === "DAV" ? "directeur" : newRole === "ADMIN" ? "admin" : "invité"}`);
    } else {
      setPinError(true);
      toast.error("Code incorrect");
      setTimeout(() => setPinError(false), 400);
      setPinInput("");
    }
  }

  function handlePinLogout() {
    setPinRole(null);
    setDirectorSessionUnlocked(false);
    localStorage.removeItem("dav_pin_role");
    void fetch("/api/director/logout", { method: "POST" }).catch(() => {});
    setShowPinModal(true);
    setPinInput("");
    setPinNotice("");
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
    setCustomSeconds(null);
    setShowCtaChoice(false);
    setPendingRewrite(null);
    setActiveCtaChoice("none");
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
    setVideoTitle("Titre en cours...");
    setTranscriptText(text);
    setPendingRewrite({ text, title: "Titre en cours..." });
    setStep("transcript");
    setShowCtaChoice(true);
  }

  // ── CTA choice (per-generation only, not persisted) ─────────────────────────
  function chooseCta(choice: CtaChoice) {
    setShowCtaChoice(false);
    setActiveCtaChoice(choice);
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

  async function autoCorrect(lang: string, script: string, feedback: string, transcript: string, attempt: number, ctaChoice: CtaChoice) {
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
      await autoCorrect(lang, accumulated, newHealth.feedback ?? "", transcript, attempt + 1, ctaChoice);
    } else {
      // The corrected script replaces the override that applyCtaToScripts wrote,
      // so put the CTA back — the corrector is deliberately fed the CTA-free
      // script, and whichever of the two finishes last would otherwise win.
      if (ctaChoice !== "none") {
        const withCta = await placeCta(accumulated, lang, ctaChoice);
        setOverrides((o) => ({ ...o, [section]: withCta }));
      }
      setCorrectingLangs((c) => { const n = { ...c }; delete n[lang]; return n; });
    }
  }

  async function runHealthCheck(scripts: Record<string, string>, transcript: string, ctaChoice: CtaChoice) {
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
            void autoCorrect(lang, scripts[lang], data.feedback?.[lang] ?? "", transcript, 0, ctaChoice);
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

  async function handleRewrite(text: string, title?: string, ctaChoice: CtaChoice = "none", attempt = 1) {
    setStep("rewriting");
    setError("");
    const targetSeconds = customSeconds !== null ? customSeconds : durationToSeconds(targetDuration);

    let res: Response;
    try {
      res = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, targetSeconds }),
      });
    } catch (networkErr) {
      console.error("Rewrite network error:", networkErr);
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1500));
        return handleRewrite(text, title, ctaChoice, attempt + 1);
      }
      setError("Impossible de joindre le serveur. Vérifie ta connexion et réessaie.");
      setStep("idle");
      return;
    }

    if (!res.ok || !res.body) {
      let errMsg = `Erreur réécriture (HTTP ${res.status})`;
      try {
        const errData = await res.json();
        errMsg = errData.error ?? errMsg;
      } catch {}
      console.error("[rewrite] API error:", errMsg);
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
        return handleRewrite(text, title, ctaChoice, attempt + 1);
      }
      setError(errMsg);
      setStep("idle");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setQrText(accumulated);
      }
    } catch (err) {
      // An interrupted stream is always incomplete, however much arrived —
      // partial output is never usable, so retry regardless of what we have.
      console.error("Rewrite stream interrupted:", err);
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1500 * attempt));
        return handleRewrite(text, title, ctaChoice, attempt + 1);
      }
      setError("La réécriture a été interrompue. Réessaie.");
      setStep("idle");
      return;
    }

    // The model occasionally stops cleanly but short, leaving later sections
    // empty. Validate against the same parse the UI renders from.
    const parsed = parseQR(accumulated);
    const missing = SECTIONS.filter((s) => !parsed[s]?.trim());
    if (missing.length > 0) {
      console.error("[rewrite] incomplete response, missing:", missing.join(", "));
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
        return handleRewrite(text, title, ctaChoice, attempt + 1);
      }
      setError(`Réponse incomplète du modèle (${missing.length} sections manquantes). Réessaie.`);
      setStep("idle");
      return;
    }

    // The model sometimes writes a CTA itself despite the prompt; the site is the
    // only one allowed to insert them, so strip any from the raw scripts.
    for (const section of SCRIPT_SECTIONS) {
      const original = parsed[section];
      if (!original) continue;
      const cleaned = stripCtaSentences(original);
      if (cleaned !== original) {
        accumulated = accumulated.replace(original, cleaned);
        parsed[section] = cleaned;
      }
    }
    setQrText(accumulated);

    const counts = SCRIPT_SECTIONS.map((s) => (parsed[s] ?? "").split(/\s+/).filter(Boolean).length);
    const spread = (Math.max(...counts) - Math.min(...counts)) / Math.max(...counts);
    if (spread > 0.2) {
      console.warn(
        `[rewrite] script lengths differ by ${Math.round(spread * 100)}% — FR/EN/DE/ES = ${counts.join("/")} words`
      );
    }

    setStep("done");
    void runHealthCheck(
      {
        FR: parsed["SCRIPT FR"] ?? "",
        EN: parsed["SCRIPT EN"] ?? "",
        DE: parsed["SCRIPT DE"] ?? "",
        ES: parsed["SCRIPT ES"] ?? "",
      },
      text,
      ctaChoice
    );
    const finalTitle = title ?? videoTitle;
    if (finalTitle) {
      saveToHistory(finalTitle, url, accumulated, text);
      saveToCloud(accumulated, finalTitle);
      void generateSummaryTitle(latestHistoryIdRef.current!, accumulated);
    }
    if (ctaChoice !== "none") {
      void applyCtaToScripts(parsed, ctaChoice);
    }
  }

  // ── TTS ───────────────────────────────────────────────────────────────────
  async function handleTTS(language: "EN" | "DE" | "FR" | "ES", voice: string, speed: number, modelId?: string, geminiParams?: { style: string; pace: string; accent: string }) {
    if (!directorSessionUnlocked) return;
    if (pinRole === "ADMIN") { toast.error("Génération vocale non disponible pour le profil Admin"); return; }
    const sectionKey = `SCRIPT ${language}` as Section;
    const text = getContent(sectionKey);
    if (!text) return;

    const titleSource = videoTitle && videoTitle !== "Titre en cours..." ? videoTitle : text.split(/\s+/).slice(0, 6).join(" ");
    const titleSlug = titleSource
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "") || "video";
    const filename = `DAV_${language}_${titleSlug}_${Date.now()}.mp3`;

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
        setAudio((s) => ({ ...s, [audioKey]: { status: "done", label: "Prêt", audioUrl, filename: `DAV_${language}_${titleSlug}_gemini_${Date.now()}.wav` } }));
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
    if (!directorSessionUnlocked) return;
    if (pinRole === "ADMIN") { toast.error("Génération vocale non disponible pour le profil Admin"); return; }
    const raw = typeof window !== "undefined" ? localStorage.getItem(VOICE_CONFIG_STORAGE_KEY) : null;
    const configs: Record<string, VoiceConfig> = raw ? JSON.parse(raw) : {};

    function getVoiceConfig(lang: string): VoiceConfig {
      const key = `${provider}__${lang}`;
      const cfg = configs[key] ?? getDefaultVoiceConfig(provider, lang);
      return { ...cfg, speed: clampSpeed(cfg.speed) };
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
      "ai33-elevenlabs": { FR: { voice: "elevenlabs_yl2ZDV1MzN4HbQJbMihG", speed: 1.0 }, EN: { voice: "elevenlabs_yl2ZDV1MzN4HbQJbMihG", speed: 1.0 }, DE: { voice: "elevenlabs_yl2ZDV1MzN4HbQJbMihG", speed: 1.0 }, ES: { voice: "elevenlabs_yl2ZDV1MzN4HbQJbMihG", speed: 1.0 } },
      "elevenlabs":      { FR: { voice: "yl2ZDV1MzN4HbQJbMihG", speed: 1.0 }, EN: { voice: "yl2ZDV1MzN4HbQJbMihG", speed: 1.0 }, DE: { voice: "yl2ZDV1MzN4HbQJbMihG", speed: 1.0 }, ES: { voice: "yl2ZDV1MzN4HbQJbMihG", speed: 1.0 } },
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
    // Replacer le CTA si un CTA était actif pour cette génération
    if (activeCtaChoice !== "none") {
      const lang = language;
      const withCta = await placeCta(accumulated, lang, activeCtaChoice);
      setOverrides((o) => ({ ...o, [section]: withCta }));
      accumulated = withCta;
    }
    void singleLangHealthCheck(language, accumulated, transcriptText).then((h) => {
      setHealthScores((hs) => ({ ...hs, [language]: h }));
    });
  }

  async function handleAdjust(section: Section, dur: AdjustDuration) {
    const raw = getContent(section);
    if (!raw || adjusting) return;
    // Strip any already-inserted CTA before sending to the model — it's
    // re-added after via placeCta, and letting it through as "content to
    // preserve" gets it paraphrased into the story and re-inserted twice.
    const text = stripCtaSentences(raw);
    await handleAdjustCore(section, { text, targetDuration: dur });
  }

  async function handleAdjustCustom(section: Section, seconds: number) {
    const raw = getContent(section);
    if (!raw || adjusting) return;
    const text = stripCtaSentences(raw);
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

  function switchTab(tab: Tab) {
    setActiveTab(tab);
    try { localStorage.setItem(TAB_KEY, tab); } catch {}
  }

  // ── Render ────────────────────────────────────────────────────────────────
  // Sans profil : uniquement l'écran du code d'accès
  if (!pinRole) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[380px]">
          <div className="flex flex-col items-center text-center">
            <span className="w-14 h-14 rounded-[18px] grid place-items-center bg-gradient-to-br from-accent to-accent-deep text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_22px_50px_-16px_rgba(76,141,255,0.65)]">
              <AudioLines size={26} strokeWidth={2.25} />
            </span>
            <h1 className="mt-5 font-display text-[36px] font-semibold leading-none">DAV Pipeline</h1>
            <p className="mt-3 text-[15px] text-muted">Entre ton code d&apos;accès pour continuer.</p>
          </div>

          {pinNotice && (
            <p className="mt-6 px-4 py-3 rounded-2xl bg-accent/10 text-[14px] leading-snug text-accent-hi text-center">{pinNotice}</p>
          )}

          <form onSubmit={handlePinSubmit} className="mt-6 space-y-3">
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              autoFocus
              aria-label="Code d'accès"
              placeholder="••••"
              className={`w-full h-16 rounded-[18px] bg-deck border text-center text-[30px] tracking-[0.6em] pl-[0.6em] text-fg placeholder:text-line focus:outline-none transition-[border-color,box-shadow] ${
                pinError ? "border-bad/70 dav-shake" : "border-line focus:border-accent/70 focus:shadow-[0_0_0_4px_rgba(76,141,255,0.12)]"
              }`}
            />
            <button
              type="submit"
              disabled={!pinInput || pinBusy}
              className="w-full h-12 rounded-[14px] inline-flex items-center justify-center gap-2 bg-accent-deep text-white text-[15px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] hover:bg-accent disabled:bg-raised disabled:text-dim disabled:shadow-none transition-colors"
            >
              {pinBusy ? <Loader2 size={17} className="animate-spin" /> : "Se connecter"}
            </button>
          </form>

          <p className="mt-10 text-center text-[13px] text-dim tabular-nums">Version {APP_VERSION}</p>
        </div>
      </div>
    );
  }

  // Invité : accès bloqué pour préserver le quota
  if (pinRole === "GUEST") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px] text-center rounded-[26px] bg-deck border border-line-soft px-7 py-9">
          <span className="mx-auto w-12 h-12 rounded-2xl grid place-items-center bg-raised text-muted">
            <Wrench size={20} />
          </span>
          <h1 className="mt-5 font-display text-[32px] font-semibold leading-none">Maintenance</h1>
          <p className="mt-3 text-[15px] text-muted leading-relaxed">
            L&apos;outil est temporairement indisponible pour les invités. Réessaie plus tard.
          </p>
          <button
            onClick={handlePinLogout}
            className="mt-7 w-full h-12 rounded-[14px] bg-raised text-fg text-[15px] font-medium hover:bg-hover transition-colors"
          >
            Changer de profil
          </button>
          <p className="mt-6 text-[13px] text-dim tabular-nums">Version {APP_VERSION}</p>
        </div>
      </div>
    );
  }

  const isIdle = step === "idle" || step === "extracting";
  const titlePending = !videoTitle || videoTitle === "Titre en cours...";

  function renderTitleItem(section: Section, label: string) {
    const content = getContent(section);
    if (!content && !sections[section]) return null;
    const text = content ?? "";
    const isCopied = copied === section;
    return (
      <div key={section} className="p-4 rounded-2xl bg-raised/50">
        <div className="flex items-center justify-between gap-3 mb-2">
          <span className="h-6 px-2 rounded-md bg-ink/60 text-[12px] font-semibold text-muted grid place-items-center">{label}</span>
          <button
            onClick={() => copySection(section, text)}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[13px] font-medium text-muted hover:text-fg hover:bg-raised transition-colors"
          >
            {isCopied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
            {isCopied ? "Copié" : "Copier"}
          </button>
        </div>
        <p className="text-[15px] text-fg/95 leading-relaxed whitespace-pre-wrap">{text}</p>
      </div>
    );
  }

  const keywordsRaw = getContent("SEARCH KEYWORDS EN") ?? "";
  const keywordsText = filterKeywords(keywordsRaw);
  const keywordList = keywordsText.split("\n").filter(Boolean);

  return (
    <div className="min-h-screen flex flex-col">
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
        user={user}
        cloudHistory={cloudHistory}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onRestoreCloud={restoreFromCloudHistory}
        pinRole={pinRole}
        onPinLogout={handlePinLogout}
        activeTab={activeTab}
        onTabChange={switchTab}
      />

      <div className="md:hidden px-4 pt-3">
        <TabSwitch activeTab={activeTab} onTabChange={switchTab} className="flex w-full" />
      </div>

      {activeTab === "download" ? (
        <iframe
          src={`${process.env.NEXT_PUBLIC_DOWNLOADER_URL ?? ""}/app`}
          title="DAV Download"
          style={{ width: "100%", height: "100vh", border: "none", display: "block" }}
        />
      ) : (
        <>
          <main className="flex-1 w-full max-w-[1240px] mx-auto px-4 sm:px-6 pb-16">
            {isIdle ? (
              <section className="max-w-[760px] mx-auto pt-12 sm:pt-20">
                <h1 className="font-display text-[44px] sm:text-[62px] font-semibold leading-[0.94] tracking-[-0.01em]">
                  De la vidéo au script
                </h1>
                <p className="mt-4 text-[16px] sm:text-[17px] text-muted max-w-[560px] leading-relaxed">
                  Colle un lien TikTok, YouTube ou Instagram. Tu récupères les scripts FR, EN, DE et ES, leurs titres et la voix off.
                </p>

                <div className="mt-8 sm:mt-10">
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
                </div>

                {step === "idle" && error && transcriptText && (
                  <button
                    onClick={() => { setError(""); void handleRewrite(transcriptText, videoTitle, activeCtaChoice); }}
                    className="mt-4 inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-accent/15 text-accent-hi text-[14px] font-semibold hover:bg-accent/25 transition-colors"
                  >
                    <RotateCcw size={15} />
                    Relancer la réécriture
                  </button>
                )}
              </section>
            ) : (
              <div className="pt-8 sm:pt-12 space-y-6">
                {/* Titre de la vidéo */}
                <div className="flex items-start justify-between gap-4">
                  <h1
                    className={`min-w-0 font-display text-[30px] sm:text-[40px] font-semibold leading-[1.02] tracking-[-0.005em] ${
                      titlePending ? "text-dim" : "text-fg"
                    }`}
                  >
                    {titlePending ? "Titre en cours…" : videoTitle}
                  </h1>
                  {url && (
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(url);
                        setCopiedUrl(true);
                        setTimeout(() => setCopiedUrl(false), 1200);
                      }}
                      className="shrink-0 mt-1 inline-flex items-center gap-2 h-10 px-3.5 rounded-xl text-[14px] font-medium text-muted bg-deck border border-line-soft hover:text-fg hover:bg-raised transition-colors"
                      title="Copier le lien de la vidéo"
                    >
                      {copiedUrl ? <Check size={15} className="text-ok" /> : <Link2 size={15} />}
                      <span className="hidden sm:inline">{copiedUrl ? "Lien copié" : "Copier le lien"}</span>
                    </button>
                  )}
                </div>

                {/* Transcript */}
                {transcriptText && (
                  <details className="group rounded-[20px] bg-deck border border-line-soft">
                    <summary className="flex items-center justify-between gap-3 px-5 h-14 cursor-pointer list-none select-none rounded-[20px] hover:bg-raised/40 transition-colors">
                      <span className="flex items-center gap-2.5 text-[15px] font-medium text-fg">
                        <ChevronRight size={16} className="text-dim transition-transform group-open:rotate-90" />
                        Transcript original
                        <span className="h-6 px-2 rounded-full bg-raised text-[12px] font-medium text-muted grid place-items-center tabular-nums">
                          {transcriptText.trim().split(/\s+/).filter(Boolean).length} mots
                        </span>
                      </span>
                      <button
                        onClick={async (e) => {
                          e.preventDefault();
                          await navigator.clipboard.writeText(transcriptText);
                          setCopiedTranscript(true);
                          toast.success("Transcript copié");
                          setTimeout(() => setCopiedTranscript(false), 1500);
                        }}
                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-[13px] font-medium text-muted hover:text-fg hover:bg-raised transition-colors"
                      >
                        {copiedTranscript ? <Check size={15} className="text-ok" /> : <Copy size={15} />}
                        {copiedTranscript ? "Copié" : "Copier"}
                      </button>
                    </summary>
                    <p className="mx-5 mb-5 p-4 rounded-2xl bg-ink/50 text-[14px] text-muted whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
                      {transcriptText}
                    </p>
                  </details>
                )}

                {/* Longueur + CTA : choisis avant la réécriture */}
                {showCtaChoice && step === "transcript" && (
                  <section className="rounded-[24px] bg-deck border border-line-soft p-5 sm:p-7 dav-rise">
                    <h2 className="font-display text-[28px] font-semibold leading-none">Réécriture</h2>
                    <p className="mt-2 text-[14px] text-dim">Choisis la longueur si besoin, puis le CTA : la réécriture démarre aussitôt.</p>

                    <div className="mt-6">
                      <p className="text-[14px] font-medium text-muted mb-2.5">Longueur des scripts</p>
                      <div className="flex flex-wrap gap-2">
                        {(["original", ...ADJUST_DURATIONS] as const).map((d) => {
                          const active = targetDuration === d && customSeconds === null;
                          return (
                            <button
                              key={d}
                              onClick={() => { setTargetDuration(d); setCustomSeconds(null); }}
                              className={`h-10 px-4 rounded-full text-[14px] font-medium transition-colors ${
                                active
                                  ? "bg-accent/15 text-accent-hi shadow-[inset_0_0_0_1px_rgba(76,141,255,0.45)]"
                                  : "bg-raised text-muted hover:text-fg hover:bg-hover"
                              }`}
                            >
                              {d === "original" ? "Original" : DURATION_LABELS[d]}
                            </button>
                          );
                        })}
                        <label
                          className={`h-10 pl-4 pr-3 rounded-full flex items-center gap-1.5 transition-colors ${
                            customSeconds !== null
                              ? "bg-accent/15 shadow-[inset_0_0_0_1px_rgba(76,141,255,0.45)]"
                              : "bg-raised"
                          }`}
                        >
                          <input
                            type="number"
                            min={1}
                            placeholder="Autre"
                            value={customSeconds ?? ""}
                            onChange={(e) => {
                              const parsed = parseInt(e.target.value, 10);
                              setCustomSeconds(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
                            }}
                            className="w-14 bg-transparent text-[14px] text-fg placeholder:text-dim focus:outline-none tabular-nums"
                            aria-label="Durée personnalisée en secondes"
                          />
                          <span className="text-[14px] text-dim">s</span>
                        </label>
                      </div>
                      {targetDuration === "original" && customSeconds === null && (
                        <p className="mt-2.5 text-[13px] text-dim">Original garde la longueur de la vidéo, avec au moins une minute de voix.</p>
                      )}
                    </div>

                    <div className="mt-7">
                      <p className="text-[14px] font-medium text-muted mb-2.5">CTA</p>
                      <div className="grid sm:grid-cols-3 gap-2.5">
                        {CTA_OPTIONS.map((o) => (
                          <button
                            key={o.id}
                            onClick={() => chooseCta(o.id)}
                            className="text-left px-4 py-3.5 rounded-2xl bg-raised border border-transparent hover:border-accent/50 hover:bg-hover transition-colors"
                          >
                            <span className="block text-[15px] font-semibold text-fg">{o.title}</span>
                            <span className="block text-[13px] text-dim mt-1 leading-snug">{o.hint}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </section>
                )}

                {/* Réécriture en cours */}
                {step === "rewriting" && (
                  <div className="space-y-6">
                    <section className="rounded-[24px] bg-deck border border-line-soft p-5 sm:p-6">
                      {(() => {
                        const sectionCount = (qrText.match(/SECTION \d+/g) || []).length;
                        const progress = Math.min(100, Math.round((sectionCount / 13) * 100));
                        return (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="flex items-center gap-2.5 text-[15px] font-medium text-fg">
                                <Loader2 size={16} className="animate-spin text-accent" />
                                Réécriture en cours
                              </span>
                              <span className="text-[15px] font-semibold text-accent-hi tabular-nums">{progress} %</span>
                            </div>
                            <div className="mt-4 h-1.5 rounded-full bg-line overflow-hidden">
                              <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${progress}%` }} />
                            </div>
                          </>
                        );
                      })()}
                      {qrText && (
                        <p className="mt-4 text-[14px] text-muted whitespace-pre-wrap leading-relaxed line-clamp-5">{qrText}</p>
                      )}
                    </section>
                    <div className="grid lg:grid-cols-2 gap-5">
                      {["FR", "EN", "DE", "ES"].map((lang) => (
                        <div key={lang} className="rounded-[22px] bg-deck border border-line-soft p-5">
                          <div className="flex items-center gap-3">
                            <span className="w-10 h-10 rounded-[13px] grid place-items-center bg-raised font-display text-[17px] font-semibold text-dim">{lang}</span>
                            <div className="space-y-2">
                              <div className="h-3 w-32 rounded-full dav-skeleton" />
                              <div className="h-2.5 w-20 rounded-full dav-skeleton" />
                            </div>
                          </div>
                          <div className="mt-5 space-y-2.5">
                            {[100, 94, 98, 88, 72].map((w, i) => (
                              <div key={i} className="h-3 rounded-full dav-skeleton" style={{ width: `${w}%` }} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Résultat */}
                {step === "done" && (
                  <div className="space-y-8">
                    <GenerationPanel
                      provider={provider}
                      onProviderChange={setProvider}
                      audio={audio}
                      onGenerate={handleGenerateLang}
                      onGenerateAll={handleGenerateAll}
                      onCopyAllQR={copyAllQR}
                      disabled={isLoading}
                      audioEnabled={directorSessionUnlocked}
                    />

                    <section>
                      <h2 className="font-display text-[28px] font-semibold leading-none mb-4 px-1">Scripts</h2>
                      <div className="grid lg:grid-cols-2 gap-5">
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
                    </section>

                    <section className="rounded-[24px] bg-deck border border-line-soft p-5 sm:p-7">
                      <h2 className="font-display text-[28px] font-semibold leading-none">Titres et mots-clés</h2>

                      <h3 className="mt-6 mb-3 text-[15px] font-semibold text-muted">Titres courts</h3>
                      <div className="grid sm:grid-cols-2 gap-3">
                        {TITLE_SHORT.map(([section, label]) => renderTitleItem(section, label))}
                      </div>

                      <h3 className="mt-7 mb-3 text-[15px] font-semibold text-muted">Titres longs</h3>
                      <div className="grid sm:grid-cols-2 gap-3">
                        {TITLE_LONG.map(([section, label]) => renderTitleItem(section, label))}
                      </div>

                      {keywordList.length > 0 && (
                        <>
                          <div className="mt-7 mb-3 flex items-center justify-between gap-3">
                            <h3 className="text-[15px] font-semibold text-muted">Mots-clés de recherche (EN)</h3>
                            <button
                              onClick={() => copySection("SEARCH KEYWORDS EN", keywordsText)}
                              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[13px] font-medium text-muted hover:text-fg hover:bg-raised transition-colors"
                            >
                              {copied === "SEARCH KEYWORDS EN" ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
                              {copied === "SEARCH KEYWORDS EN" ? "Copié" : "Copier"}
                            </button>
                          </div>
                          <ul className="flex flex-wrap gap-2">
                            {keywordList.map((kw, i) => (
                              <li key={`${kw}-${i}`} className="h-9 px-3.5 rounded-full bg-raised/70 text-[14px] text-fg/90 flex items-center">
                                {kw}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </section>
                  </div>
                )}
              </div>
            )}
          </main>

          <footer className="py-8 text-center text-[13px] text-dim flex items-center justify-center gap-2">
            <span className="tabular-nums">DAV Pipeline 2026, version {APP_VERSION}</span>
            {/* Point d'accès caché vers Clone Script Pipeline — invisible, pas de lien nav */}
            <a
              href="/csp"
              tabIndex={-1}
              aria-hidden="true"
              className="w-2 h-2 shrink-0 rounded-full"
              style={{ background: "transparent" }}
            />
          </footer>

          <CommandPalette
            open={showPalette}
            onClose={() => setShowPalette(false)}
            onPasteUrl={() => { reset(); setTimeout(() => { const el = document.querySelector("input[type=text]") as HTMLInputElement; el?.focus(); }, 50); }}
            onGenerateFR={() => { const c = getVoiceConfigForLang("FR"); handleTTS("FR", c.voice, c.speed); }}
            onGenerateEN={() => { const c = getVoiceConfigForLang("EN"); handleTTS("EN", c.voice, c.speed); }}
            onGenerateDE={() => { const c = getVoiceConfigForLang("DE"); handleTTS("DE", c.voice, c.speed); }}
            onGenerateES={() => { const c = getVoiceConfigForLang("ES"); handleTTS("ES", c.voice, c.speed); }}
            onGenerateAll={handleGenerateAll}
            onCopyAllQR={() => { copyAllQR(); toast.success("Les 13 sections sont copiées"); }}
            onReset={reset}
            hasContent={step === "done"}
          />

          <FloatingActions onCopyAllQR={() => { copyAllQR(); }} show={step === "done"} />
        </>
      )}
    </div>
  );
}
