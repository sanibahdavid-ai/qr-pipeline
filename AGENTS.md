# AGENTS.md — qr-pipeline (DAV Pipeline)

Lis ce fichier avant toute intervention sur ce dépôt. Documentation exhaustive de référence (générée pour la migration Claude Code → Antigravity, à consulter pour tout détail non couvert ici) : `C:\Users\DELL\Downloads\migration-antigravity\qr-pipeline.md`. Prompts exacts de réécriture : voir `.agents/rules/prompts.md` dans ce même dépôt.

## Ce que fait ce projet

Pipeline de création de contenu : extrait le transcript d'une vidéo (YouTube/TikTok/Instagram) → le réécrit via Claude Sonnet 4.6 en scripts multilingues FR/EN/DE/ES au format "QR" (13 sections : 4 scripts + 8 mots-clés + 4 titres courts + 4 titres longs) → score la qualité (Claude Haiku) et auto-corrige si score < 80 → génère l'audio TTS (5 fournisseurs) → onglet séparé pour télécharger des vidéos (yt-dlp + Cloudflare R2).

## Lancer le projet

Deux process en parallèle, obligatoires tous les deux pour un fonctionnement complet :

```bash
cd C:\projets\qr-pipeline
npm run dev              # Next.js — PORT RÉEL 3001 (pas 3000, malgré PROJECT_DOC.json obsolète)
python server/dav_downloader.py   # Flask (downloader) — port 5757, terminal séparé
```

URL locale : `http://localhost:3001`. Prod : `https://qr-pipeline.onrender.com` (Render, un seul service qui fait tourner les deux process).

## Fichiers à ne jamais casser sans comprendre l'impact

- `app/api/rewrite/route.ts` — le `SYSTEM_PROMPT` exact de réécriture. Format de sortie strict en 13 sections (`SCRIPT FR`, `SCRIPT EN`, etc.) — `parseQR()` dans `app/page.tsx` dépend de ces libellés EXACTS. Ne jamais modifier l'un sans l'autre.
- `types.ts` — `Section`, `HistoryEntry`, etc. Doit rester synchronisé avec les libellés du prompt.
- `next.config.ts` — règles de proxy vers Flask (port 5757).
- `DP_REWRITE_METHODOLOGY.json` — mémoire institutionnelle du prompt : liste 9 erreurs déjà commises et corrigées (traductions calquées entre langues, hook tronqué, mots-clés abstraits, CTA dupliqué, transcript sans ponctuation...). **Lire ce fichier avant de proposer une modification du prompt de réécriture**, pour ne pas réintroduire une erreur déjà corrigée.

## Règles absolues si tu touches à la génération de scripts

1. Ne jamais changer les libellés des 13 sections sans mettre à jour `parseQR()`.
2. Le prompt exige : même histoire dans les 4 langues, jamais une traduction d'une langue vers une autre, zéro tiret, mots interdits listés dans le prompt, noms propres complets conservés dans le hook, longueur ±10% de l'original.
3. Le CTA (Cristiano/bouton plus, ou message TikTok "follow") n'est **jamais** généré par le modèle — il est détecté et supprimé de la source (Étape 0 du prompt) puis injecté séparément côté client via `/api/place-cta` après coup. Ne jamais réintroduire le CTA dans le `SYSTEM_PROMPT`.
4. Le health-check calibre un script fidèle et bien reformulé à 90-98/100 — si tu ajustes ce prompt, ne pas re-durcir les critères (bug historique déjà corrigé, voir `DP_REWRITE_METHODOLOGY.json`).

## Clés API — emplacement, pas les valeurs

Toutes dans `C:\projets\qr-pipeline\.env.local` (dev Next.js) et `.env.render` (dev Flask local). Ne jamais committer ces fichiers. Avant de toucher à l'auth/l'historique cloud, vérifier ces pièges connus :

- `ANTHROPIC_API_KEY` diffère entre `.env.local` et `.env.render` — vérifier laquelle est active sur Render en prod avant de se fier à l'une ou l'autre.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` dans `.env.local` est corrompue (fusionnée avec un fragment de `GROQ_API_KEY` sur la même ligne, sans retour à la ligne). Utiliser la version propre dans `.env.render`.
- `groq-sdk` est dans `package.json` mais n'est importé nulle part — dépendance morte.
- Le domaine Supabase (`zentofapbmyajtiawuqn.supabase.co`) ne s'est pas résolu en DNS pendant la documentation — vérifier son état réel (projet en pause ? supprimé ?) avant de développer une fonctionnalité qui en dépend.
- `eleven_multilingual_v3` n'est PAS un ID de modèle ElevenLabs valide (erreur `model_not_found` vérifiée) — utiliser `eleven_v3`.
- Les endpoints AI33Pro `/v1/text-to-speech` et `/v1m/task/text-to-speech` sont dépréciés — utiliser `/v3/text-to-speech` avec `voice_id` préfixé (`elevenlabs_`, `minimax_`, `clone_`, `edge_`, `kokoro_`...).

## Historique des générations

Ne vit ni en base de données ni en fichier local : soit `localStorage` du navigateur (clé `qr_pipeline_history`, non connecté), soit table Supabase `generations` (connecté via Google OAuth). Voir `C:\Users\DELL\Downloads\migration-antigravity\historique-dav-pipeline\README.md` pour le format exact et les scripts d'export.
