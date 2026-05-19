# DAV PIPELINE v2.1 — Design & UX Brief

> Brief technique pour Claude Code. Objectif : refactor UI sans casser les routes API existantes (`/api/transcript`, `/api/generate-script`, `/api/tts/*`).

---

## 1. Philosophie

Continuer la direction **terminal-brutalist** actuelle (mono font, dark, cards minimalistes) mais resserrer l'information et **tuer la redondance**.

Références :
- **Linear** → densité, hiérarchie typographique
- **Raycast** → command palette, raccourcis clavier
- **Vercel / Geist** → typographie mono + sans, contraste
- **ElevenLabs** → audio inline, waveform aesthetics
- **Cursor** → minimalisme tech dark

Principe directeur : *un opérateur doit pouvoir générer FR/EN/DE en moins de 3 clics, et tout au clavier s'il veut*.

---

## 2. Design tokens (Tailwind v4 + CSS vars)

À mettre dans `app/globals.css` :

```css
@theme {
  /* Couleurs */
  --color-bg: #0A0A0A;
  --color-surface: #141414;
  --color-surface-hover: #1C1C1C;
  --color-border: #262626;
  --color-border-strong: #404040;
  --color-text: #F5F5F5;
  --color-text-muted: #A3A3A3;
  --color-text-dim: #525252;
  --color-accent: #FAFAFA;
  --color-accent-fg: #0A0A0A;
  --color-success: #22C55E;
  --color-warning: #F59E0B;
  --color-danger: #EF4444;

  /* Typo */
  --font-mono: "JetBrains Mono", "Berkeley Mono", ui-monospace, monospace;
  --font-sans: "Geist Sans", ui-sans-serif, system-ui;

  /* Spacing scale 4px-based — Tailwind par défaut convient */

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
}
```

Installer fonts :
```bash
pnpm add @fontsource-variable/jetbrains-mono geist
```

Et dans `layout.tsx` :
```ts
import "@fontsource-variable/jetbrains-mono";
import { GeistSans } from "geist/font/sans";
```

Règles typo :
- **Headers / chiffres / labels UPPER** → `font-mono`
- **Body / scripts générés** → `font-sans`
- **tracking-tight** sur titres, **tracking-[0.2em] uppercase text-xs** sur labels de section

---

## 3. Layout — vue d'ensemble (top → bottom)

```
┌──────────────────────────────────────────────────────────────┐
│ HEADER (sticky, backdrop-blur)                               │
│ DAV PIPELINE v2.1    [⌘K]  [HISTORIQUE 4]  [RÉINITIALISER]  │
├──────────────────────────────────────────────────────────────┤
│ URL INPUT                                                    │
│ [https://...                              ] [YT]  →         │
├──────────────────────────────────────────────────────────────┤
│ TRANSCRIPT (collapsable si > 200 chars)                      │
│ ▸ Transcript original · 247 mots · EN                  [⎘]  │
├──────────────────────────────────────────────────────────────┤
│ GENERATE PANEL (toujours visible — CŒUR DU REDESIGN)        │
│                                                              │
│ Provider  ●Minimax  ○ElevenLabs  ○EL Direct  ○Edge TTS     │
│ Duration  [10s] [15s] [30s] [45s] [1min] [1m30] [2min]      │
│ ─────────────────────────────────────────────────────────── │
│ FR  [Henri (Homme) ▾]  [━●━ +0%]  [▶ Générer]  ● ready     │
│ EN  [Guy (Male)    ▾]  [━●━ +0%]  [▶ Générer]  ⠋ loading   │
│ DE  [Killian (Mann)▾]  [━●━ +0%]  [▶ Générer]  ○ idle      │
│                                                              │
│ [▶ Générer les 3 langues]                      [⎘ Tout (QR)]│
├──────────────────────────────────────────────────────────────┤
│ SCRIPTS (grid 3-col md+, stack mobile)                       │
│ ┌────────────┐ ┌────────────┐ ┌────────────┐                │
│ │ SCRIPT FR  │ │ SCRIPT EN  │ │ SCRIPT DE  │                │
│ │ 110w · 51s │ │ 98w · 47s  │ │ 124w · 58s │                │
│ │ texte...   │ │ texte...   │ │ texte...   │                │
│ │ ▶ ━●━ 0:51 │ │ ▶ ━●━ 0:47 │ │ ▶ ━●━ 0:58 │                │
│ └────────────┘ └────────────┘ └────────────┘                │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. Composants à créer

### `<Header />` (sticky)
- Backdrop-blur, border-bottom subtle
- Logo gauche : `DAV PIPELINE` en mono + version badge
- Actions droite : Command trigger `⌘K`, Historique (badge count), Réinitialiser
- Plus de "MADE BY DAV" en sous-titre (on libère du vertical)

### `<UrlInput />`
- Input pleine largeur, mono, large (h-12 ou h-14)
- Détection automatique YouTube / TikTok / Instagram via regex
- Badge platform 2-letter (`YT`, `TT`, `IG`) qui apparaît dans l'input quand l'URL est valide
- Submit on `Enter` OU au paste si URL détectée
- État loading inline (border-pulse, pas de spinner externe)

### `<TranscriptCard />`
- Collapsable par défaut si > 200 chars (affiche les 2 premières lignes)
- Header : `TRANSCRIPT ORIGINAL · {wordCount} mots · {lang.toUpperCase()}`
- Action `Copier` à droite

### `<GenerationPanel />` ⭐ CŒUR DU REDESIGN
Remplace **les boutons `Voix EN` / `Voix DE` / `Réglages`** par un panneau permanent.

Structure :
```tsx
<Card className="generation-panel">
  <ProviderTabs />        {/* Minimax | ElevenLabs | EL Direct | Edge TTS */}
  <DurationToggleGroup /> {/* 10s | 15s | 30s | 45s | 1min | 1m30 | 2min */}
  <Separator />
  <LanguageRow lang="FR" />
  <LanguageRow lang="EN" />
  <LanguageRow lang="DE" />
  <Footer>
    <Button>Générer les 3 langues</Button>
    <Button variant="ghost">Tout copier (QR)</Button>
  </Footer>
</Card>
```

### `<LanguageRow />`
Ligne compacte unique par langue :
```
[FR] [voice-select ▾] [speed-slider] [+0%] [▶ Générer] [status]
```
- `lang` : badge 2-letter mono uppercase
- `voice` : `<Select>` qui se met à jour selon provider (Minimax voices ≠ Edge TTS voices)
- `speed` : `<Slider min={-50} max={50} step={5}>` avec label `+0%` à droite
- `Générer` : bouton mono, devient `Régénérer` après première génération
- `status` : indicator `○ idle` / `⠋ loading` / `● ready` / `✗ error`
- Si audio généré : remplacer status par mini-waveform inline cliquable (play/pause)

Persistance : `useVoiceConfig(provider, lang)` hook qui save voice+speed en localStorage par couple `(provider, lang)`.

### `<ScriptCard />`
Card par langue avec :
- Header : `SCRIPT {LANG}` + badges `{wordCount}w · {duration}s` + actions `[Copy] [↻ Régénérer]`
- Body : script complet en `font-sans`, line-height généreux (1.7)
- Footer : audio player inline si généré
  - `<audio>` natif stylé custom : play button + progress bar + time + download
  - Pas de waveform compliquée — une barre de progression suffit (KISS)

### `<CommandPalette />` (cmdk)
Déclenché par `⌘K` :
- Coller nouvelle URL
- Régénérer FR / EN / DE
- Tout générer
- Tout copier QR
- Changer provider
- Ouvrir historique
- Réinitialiser

### `<FloatingActions />` (mobile + scroll)
Pill en bottom-right quand scrollé sous le panneau de génération :
- `⎘ Copy QR` toujours accessible
- `↑ Top` pour remonter

---

## 5. Interactions

### Raccourcis clavier (use `react-hotkeys-hook`)
| Touche | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Command palette |
| `⌘V` dans URL field | Auto-submit si URL valide |
| `1` / `2` / `3` | Play audio FR / EN / DE |
| `⌘C` | Copy current focused script |
| `⌘⇧C` | Copy all (QR format) |
| `G` puis `A` | Generate all 3 |
| `G` puis `F/E/D` | Generate FR / EN / DE |
| `Esc` | Fermer palette / reset focus |

### Loading states
- **Skeleton** sur cards en attente (animation shimmer subtle, pas de spinner)
- **Streaming text** : si l'endpoint Claude streame, afficher le texte token par token dans la card script (effet typing)
- **Audio gen** : progress bar inline dans le bouton `Générer` (`Générer • 34%`)
- **Pas de spinner full-page** jamais

### Micro-interactions
- Boutons : hover = **invert instant** (bg blanc, fg noir) — no transition (brutalist)
- Cards : hover = `border-color` → `border-strong`, no scale, no shadow
- Inputs : focus = `ring-1 ring-white/20` (jamais le ring bleu par défaut)
- Toggle group : item actif = bg blanc + fg noir
- Slider : track minimal, thumb carré 12px (pas rond — brutalist touch)

### Feedback
- **Sonner** pour toasts (copy success, error API, etc.)
- Position : `top-right`, theme dark, mono font
- Durée 2.5s max

---

## 6. shadcn/ui components à installer

```bash
pnpm dlx shadcn@latest add tabs toggle-group slider select command sonner badge separator skeleton
```

Override les composants pour matcher la palette mono :
- `Button` variants : `default` (white bg / black fg, invert hover), `ghost` (transparent), `outline` (border-only)
- `Card` : pas de shadow, juste `border + bg-surface`
- `Tabs` : underline mono, pas de bg switch
- `ToggleGroup` : items mono, actif = invert

---

## 7. Backend — TikTok support (`/api/transcript/route.ts`)

**Bonne nouvelle** : Supadata gère déjà TikTok sur le même endpoint `/v1/transcript`. Pas besoin d'API supplémentaire.

Changements à faire :

```ts
// Détection plateforme
function detectPlatform(url: string): "youtube" | "tiktok" | "instagram" | null {
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  if (/tiktok\.com/.test(url)) return "tiktok";
  if (/instagram\.com/.test(url)) return "instagram";
  return null;
}

// Endpoint Supadata accepte les 3 — un seul code path
const res = await fetch(
  `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(url)}&text=true&mode=auto`,
  { headers: { "x-api-key": process.env.SUPADATA_API_KEY! } }
);
```

Notes :
- `mode=auto` : tente d'abord les captions natives, fallback AI generation si absent (utile pour TikTok souvent sans captions)
- `mode=native` : moins cher (1 crédit) mais échoue si pas de captions
- Recommandation : tester `mode=native` d'abord, si erreur `transcript-unavailable` → retry `mode=generate`
- Gérer le retour HTTP 202 (async) : Supadata peut renvoyer un `jobId`, il faut poll `/v1/transcript/{jobId}` toutes les 1s

```ts
async function fetchTranscript(url: string) {
  const platform = detectPlatform(url);
  if (!platform) throw new Error("Unsupported URL");

  // 1er try: natif (1 crédit)
  let res = await supadataCall(url, "native");
  if (res.status === 206) {
    // Pas de captions natives → fallback génération AI (2 crédits/min)
    res = await supadataCall(url, "generate");
  }

  // Gérer async (HTTP 202)
  if (res.status === 202) {
    const { jobId } = await res.json();
    return pollJob(jobId);
  }
  return res.json();
}
```

---

## 8. Phases d'implémentation (ordre des commits)

### Phase 1 — Foundations (1 commit)
1. Installer fonts + shadcn components
2. Configurer `globals.css` avec les tokens
3. Mettre à jour `tailwind.config.ts` si nécessaire

### Phase 2 — Backend TikTok (1 commit)
4. Refactor `/api/transcript/route.ts` avec `detectPlatform` + retry native→generate
5. Gérer le polling HTTP 202
6. Tests manuels : YouTube + TikTok + Instagram

### Phase 3 — GenerationPanel (2 commits)
7. Créer `<GenerationPanel />` + `<LanguageRow />`
8. Hook `useVoiceConfig` avec localStorage
9. Câbler sur les routes TTS existantes
10. Supprimer les anciens boutons `Voix EN/DE/Réglages` du layout principal
11. Implémenter `Generate all 3` avec `Promise.allSettled`

### Phase 4 — ScriptCards refactor (1 commit)
12. Créer `<ScriptCard />` avec audio player inline
13. Grid responsive
14. Si endpoint script streame : afficher texte progressif

### Phase 5 — Power user features (1 commit)
15. Command palette `⌘K`
16. Raccourcis clavier globaux
17. Auto-détection plateforme dans URL input
18. Toast feedback Sonner

### Phase 6 — Polish (1 commit)
19. Skeleton loading states
20. Sticky header backdrop-blur
21. Floating action bar mobile
22. Empty state custom ("Colle une URL pour commencer")

---

## 9. Checklist "ne casse rien"

- [ ] Routes API inchangées (`/api/transcript`, `/api/generate-script`, `/api/tts/*`)
- [ ] localStorage existant (historique 4 entries) survit
- [ ] "Tout copier (QR)" garde son format de sortie existant
- [ ] Le sélecteur de durée (10s..2min) reste fonctionnel sur le script
- [ ] Les 3 langues FR/EN/DE restent le default
- [ ] Variables d'env inchangées (`ANTHROPIC_API_KEY`, `SUPADATA_API_KEY`, etc.)
- [ ] Build Netlify passe (pas de dépendances payantes ajoutées)

---

## 10. Pas faire (anti-patterns)

- ❌ Pas de couleur primaire vive (bleu / violet / vert décoratif). Le mono blanc/noir EST l'accent.
- ❌ Pas de gradient, pas de glassmorphism, pas de glow neon
- ❌ Pas de transitions > 150ms — brutalist veut dire réactif
- ❌ Pas de spinners externes pour loadings — toujours inline dans le composant qui charge
- ❌ Pas de modals pour les réglages — tout permanent ou collapsable inline
- ❌ Pas de border-radius > 12px — on garde des angles nets
- ❌ Pas de drop-shadow sur les cards — la séparation se fait par les borders
- ❌ Pas d'emojis dans l'UI — icons Lucide React uniquement

---

## 11. Stack final résumé

| Couche | Technologie |
|---|---|
| Framework | Next.js 15 (existant) |
| Style | Tailwind CSS v4 + CSS vars |
| Composants | shadcn/ui |
| Fonts | JetBrains Mono + Geist Sans |
| Icons | Lucide React |
| Toasts | Sonner |
| Shortcuts | react-hotkeys-hook |
| Command palette | cmdk (via shadcn Command) |
| State persistence | localStorage (existant) |
| Backend transcript | Supadata API (existant) — TikTok via même endpoint |

**Aucune dépendance payante ajoutée.**

---

## Annexe — exemple de prompt pour Claude Code

```
@DESIGN_BRIEF.md

Implémente la Phase 1 (Foundations) :
1. Installe les fonts JetBrains Mono et Geist Sans
2. Configure les tokens CSS dans app/globals.css selon la section 2 du brief
3. Installe ces composants shadcn : tabs, toggle-group, slider, select, command, sonner, badge, separator, skeleton
4. Ne touche à aucun composant existant pour le moment
5. Vérifie que le build passe localement avec `pnpm build`
```

Puis successivement pour Phase 2, 3, etc.
