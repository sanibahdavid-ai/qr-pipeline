"""Module d'analyse forensique — 3 niveaux :

1. analyze_video()   : par vidéo, appel Claude (texte transcript + vision
                        miniature) -> JSON structuré + rapport markdown.
2. analyze_channel() : agrège les vidéos d'une chaîne (calculs déterministes
                        en Python, jamais de calcul confié au LLM) + un appel
                        Claude pour la synthèse qualitative.
3. consolidate_pattern() : agrège les 4 chaînes -> pattern commun consolidé,
                        avec en particulier une longueur cible de script
                        (moyenne concurrents UNIQUEMENT, rôle="concurrent")
                        et des règles de style de titre concrètes
                        (casse/longueur/type d'accroche/mots-clés), utilisées
                        telles quelles par generator.py.

Le style de titre est extrait comme critère structuré explicite à chaque
niveau (pas une simple description en prose) pour pouvoir être réinjecté
concrètement dans le prompt de génération de titre.
"""
import argparse
import base64
import json
import re
import statistics
import sys
from collections import Counter
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from modules.common import (
    ANALYSIS_DIR,
    CHANNELS_DIR,
    channel_analysis_dir,
    channel_video_dir,
    ensure_dirs,
    get_env,
    load_channel,
    load_channels,
    log_step,
    read_json,
    write_json,
)

MODEL = "claude-sonnet-5"


def _client():
    import anthropic

    return anthropic.Anthropic(api_key=get_env("ANTHROPIC_API_KEY", required=True))


def _response_text(resp) -> str:
    for block in resp.content:
        if getattr(block, "type", None) == "text":
            return block.text
    raise RuntimeError("Réponse Claude sans bloc texte (uniquement thinking/tool_use ?)")


def _extract_json(raw_text: str) -> dict:
    text = raw_text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(json)?", "", text).strip()
        text = re.sub(r"```$", "", text).strip()
    return json.loads(text)


VIDEO_ANALYSIS_SCHEMA = """{
  "narrative_skeleton": {"accroche": "...", "developpement": "...", "chute": "..."},
  "cta_list": [
    {"text_quote": "citation quasi-verbatim tirée du transcript", "position_estimate_pct": 0, "formulation_style": "...", "ton": "..."}
  ],
  "non_narrative_chars_estimate": 0,
  "thumbnail_style": {
    "composition": "...", "texte_overlay": "...", "couleurs_dominantes": ["..."],
    "expressions_visages": "...", "codes_visuels_genre": "..."
  },
  "title_style": {
    "casse": "ALL CAPS | Title Case | Sentence case | Mixed",
    "longueur_caracteres": 0,
    "longueur_mots": 0,
    "type_accroche": "contre-intuitif | urgence | chiffre-choc | question-rhetorique | retournement | peur | autorite | autre",
    "mots_cles_recurrents": ["..."],
    "structure_formule": "ex: '<Sujet> Just <Action> — <Consequence>' (avec les vrais placeholders observés)"
  },
  "notes": "toute observation utile non couverte ci-dessus"
}"""


def build_video_prompt(meta: dict, transcript: str) -> str:
    return f"""Tu es un analyste forensique de chaînes YouTube (analyse concurrentielle,
pas de reproduction). Analyse CETTE vidéo à partir de son transcript et de sa miniature.

Titre : {meta.get('title', '')}
Vues : {meta.get('view_count', 0)}
Description (tronquée) : {(meta.get('description') or '')[:500]}

Transcript (auto-généré, ponctuation approximative) :
---
{transcript[:15000]}
---

Réponds UNIQUEMENT avec un objet JSON valide (rien avant, rien après), au format exact
suivant :
{VIDEO_ANALYSIS_SCHEMA}

Consignes précises :
- "non_narrative_chars_estimate" = estimation du nombre de caractères du transcript qui
  relèvent des CTA + parasites (pubs, tangentes hors-sujet), PAS de la narration.
- "title_style" doit être factuel et mesurable, pas une description vague : casse réelle,
  longueur réelle en caractères/mots, mots-clés réellement présents dans CE titre.
- Analyse structurelle uniquement (squelette, CTA, style) — n'invente rien qui ne soit
  pas observable dans le transcript/la miniature fournis.
"""


def analyze_video(slug: str, video_id: str, force: bool = False) -> dict:
    video_dir = channel_video_dir(slug, video_id)
    meta = read_json(video_dir / "meta.json")
    out_dir = channel_analysis_dir(slug)
    out_dir.mkdir(parents=True, exist_ok=True)
    rank = meta.get("rank", 0)
    json_path = out_dir / f"video_{rank:02d}_analyse.json"
    md_path = out_dir / f"video_{rank:02d}_analyse.md"

    if json_path.exists() and not force:
        log_step("ANALYZE", f"{slug} video {video_id} — déjà analysée, skip")
        return read_json(json_path)

    transcript = (video_dir / "transcript.txt").read_text(encoding="utf-8")
    if not transcript.strip():
        log_step("ANALYZE", f"{slug} video {video_id} — pas de transcript disponible, analyse limitée")

    thumb_path = video_dir / "thumbnail.jpg"
    image_block = None
    if thumb_path.exists():
        b64 = base64.standard_b64encode(thumb_path.read_bytes()).decode("ascii")
        image_block = {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}}

    content = []
    if image_block:
        content.append(image_block)
    content.append({"type": "text", "text": build_video_prompt(meta, transcript)})

    log_step("ANALYZE", f"{slug} video {video_id} — appel Claude...")
    client = _client()
    resp = client.messages.create(
        model=MODEL, max_tokens=3000, messages=[{"role": "user", "content": content}]
    )
    analysis = _extract_json(_response_text(resp))

    transcript_len = len(transcript)
    non_narrative = int(analysis.get("non_narrative_chars_estimate", 0) or 0)
    analysis["script_length_chars"] = max(0, transcript_len - non_narrative)
    analysis["transcript_length_chars"] = transcript_len
    analysis["video_id"] = video_id
    analysis["rank"] = rank
    analysis["title"] = meta.get("title", "")
    analysis["view_count"] = meta.get("view_count", 0)

    write_json(json_path, analysis)
    md_path.write_text(render_video_markdown(meta, analysis), encoding="utf-8")
    log_step("ANALYZE", f"{slug} video {video_id} — OK (script_length={analysis['script_length_chars']} chars)")
    return analysis


def render_video_markdown(meta: dict, a: dict) -> str:
    ts = a.get("title_style", {})
    lines = [
        f"# Analyse — {meta.get('title', '')}",
        "",
        f"Vues : {meta.get('view_count', 0):,} | Longueur script (hors CTA/parasites) : {a.get('script_length_chars', 0):,} caractères",
        "",
        "## Squelette narratif",
        f"- **Accroche** : {a['narrative_skeleton'].get('accroche', '')}",
        f"- **Développement** : {a['narrative_skeleton'].get('developpement', '')}",
        f"- **Chute** : {a['narrative_skeleton'].get('chute', '')}",
        "",
        "## CTA",
    ]
    for cta in a.get("cta_list", []):
        lines.append(
            f"- ~{cta.get('position_estimate_pct', 0)}% — *{cta.get('formulation_style', '')}* "
            f"(ton: {cta.get('ton', '')}) — « {cta.get('text_quote', '')} »"
        )
    lines += [
        "",
        "## Style de la miniature",
        f"- Composition : {a['thumbnail_style'].get('composition', '')}",
        f"- Texte overlay : {a['thumbnail_style'].get('texte_overlay', '')}",
        f"- Couleurs dominantes : {', '.join(a['thumbnail_style'].get('couleurs_dominantes', []))}",
        f"- Expressions/visages : {a['thumbnail_style'].get('expressions_visages', '')}",
        f"- Codes visuels du genre : {a['thumbnail_style'].get('codes_visuels_genre', '')}",
        "",
        "## Style du titre",
        f"- Casse : {ts.get('casse', '')}",
        f"- Longueur : {ts.get('longueur_caracteres', 0)} caractères / {ts.get('longueur_mots', 0)} mots",
        f"- Type d'accroche : {ts.get('type_accroche', '')}",
        f"- Mots-clés récurrents : {', '.join(ts.get('mots_cles_recurrents', []))}",
        f"- Formule structurelle : {ts.get('structure_formule', '')}",
        "",
        "## Notes",
        a.get("notes", ""),
    ]
    return "\n".join(lines)


def _mode(values: list[str]) -> str:
    values = [v for v in values if v]
    if not values:
        return ""
    return Counter(values).most_common(1)[0][0]


def aggregate_title_style(video_analyses: list[dict]) -> dict:
    styles = [a.get("title_style", {}) for a in video_analyses]
    lengths_chars = [s.get("longueur_caracteres", 0) for s in styles if s.get("longueur_caracteres")]
    lengths_words = [s.get("longueur_mots", 0) for s in styles if s.get("longueur_mots")]
    kw = Counter()
    for s in styles:
        for k in s.get("mots_cles_recurrents", []):
            kw[k.lower()] += 1
    return {
        "casse_dominante": _mode([s.get("casse", "") for s in styles]),
        "type_accroche_dominant": _mode([s.get("type_accroche", "") for s in styles]),
        "longueur_caracteres_moyenne": round(statistics.mean(lengths_chars)) if lengths_chars else 0,
        "longueur_mots_moyenne": round(statistics.mean(lengths_words)) if lengths_words else 0,
        "mots_cles_recurrents_top": [w for w, _ in kw.most_common(12)],
        "formules_structurelles_observees": [s.get("structure_formule", "") for s in styles if s.get("structure_formule")],
    }


def analyze_channel(slug: str, force: bool = False) -> dict:
    channel = load_channel(slug)
    video_dir_root = CHANNELS_DIR / slug / "videos"
    video_ids = sorted(
        [p.name for p in video_dir_root.iterdir() if (p / "meta.json").exists()]
    ) if video_dir_root.exists() else []

    video_analyses = []
    for vid in video_ids:
        video_analyses.append(analyze_video(slug, vid, force=force))
    video_analyses.sort(key=lambda a: a.get("rank", 0))

    out_dir = channel_analysis_dir(slug)
    json_path = out_dir / "synthese_chaine.json"
    md_path = out_dir / "synthese_chaine.md"

    if not video_analyses:
        log_step("ANALYZE", f"{slug} — aucune vidéo analysée, synthèse impossible")
        return {}

    title_style_agg = aggregate_title_style(video_analyses)
    lengths = [a["script_length_chars"] for a in video_analyses]
    length_agg = {
        "moyenne": round(statistics.mean(lengths)),
        "min": min(lengths),
        "max": max(lengths),
        "n_videos": len(lengths),
    }

    log_step("ANALYZE", f"{slug} — synthèse de chaîne (appel Claude)...")
    client = _client()
    prompt = f"""Tu es un analyste forensique YouTube. Voici les analyses structurées des
{len(video_analyses)} vidéo(s) les plus vues de la chaîne "{slug}" (rôle: {channel['role']}) :

{json.dumps(video_analyses, ensure_ascii=False, indent=2)[:12000]}

Agrégats déjà calculés (à réutiliser tels quels, ne pas recalculer) :
- Longueur de script (hors CTA/parasites) : moyenne {length_agg['moyenne']} caractères
  (min {length_agg['min']}, max {length_agg['max']}, sur {length_agg['n_videos']} vidéo(s))
- Style de titre agrégé : {json.dumps(title_style_agg, ensure_ascii=False)}

Rédige une synthèse structurelle de la chaîne au format markdown, avec ces sections :
1. Le squelette en blocs (tableau : # / Bloc / Fonction / Timing type), confirmé sur les
   vidéos analysées.
2. Formules récurrentes (verbatim ou quasi-verbatim).
3. Ton et positionnement.
4. Paramètres de production observés (durée type, découpage en blocs, nombre de CTA...).
5. Style de titre — section dédiée qui REPREND CONCRÈTEMENT les agrégats fournis ci-dessus
   (casse dominante, longueur moyenne, type d'accroche dominant, mots-clés récurrents,
   formules structurelles observées) et les illustre avec les titres réels analysés.
6. Ce qui varie d'une vidéo à l'autre (si plusieurs vidéos disponibles).

Si une seule vidéo est disponible, dis-le explicitement en introduction (échantillon limité)
plutôt que de généraliser abusivement.
"""
    resp = client.messages.create(model=MODEL, max_tokens=3000, messages=[{"role": "user", "content": prompt}])
    synthesis_md = _response_text(resp)

    channel_json = {
        "slug": slug,
        "role": channel["role"],
        "n_videos": len(video_analyses),
        "script_length": length_agg,
        "title_style": title_style_agg,
        "video_ids": [a["video_id"] for a in video_analyses],
    }
    write_json(json_path, channel_json)
    md_path.write_text(synthesis_md, encoding="utf-8")
    log_step("ANALYZE", f"{slug} — synthèse OK")
    return channel_json


def consolidate_pattern(force: bool = False) -> dict:
    ensure_dirs()
    channels = load_channels()
    channel_jsons = []
    for ch in channels:
        cj_path = channel_analysis_dir(ch["slug"]) / "synthese_chaine.json"
        if not cj_path.exists() or force:
            cj = analyze_channel(ch["slug"], force=force)
        else:
            cj = read_json(cj_path)
        if cj:
            channel_jsons.append(cj)

    concurrent_jsons = [c for c in channel_jsons if c["role"] == "concurrent"]
    if not concurrent_jsons:
        raise RuntimeError("Aucune chaîne concurrente analysée — impossible de consolider.")

    # Longueur cible = moyenne des scripts CONCURRENTS uniquement (pas la référence),
    # calculée directement sur toutes les vidéos concurrentes (pas une moyenne de moyennes).
    concurrent_video_lengths = []
    for ch in channels:
        if ch["role"] != "concurrent":
            continue
        for jf in sorted(channel_analysis_dir(ch["slug"]).glob("video_*_analyse.json")):
            concurrent_video_lengths.append(read_json(jf)["script_length_chars"])
    target_length_chars = round(statistics.mean(concurrent_video_lengths))

    kw = Counter()
    casse_votes, accroche_votes = [], []
    formules = []
    for c in concurrent_jsons:
        ts = c["title_style"]
        casse_votes.append(ts.get("casse_dominante", ""))
        accroche_votes.append(ts.get("type_accroche_dominant", ""))
        for w in ts.get("mots_cles_recurrents_top", []):
            kw[w] += 1
        formules += ts.get("formules_structurelles_observees", [])

    title_style_consolidated = {
        "casse_dominante": _mode(casse_votes),
        "type_accroche_dominant": _mode(accroche_votes),
        "longueur_caracteres_cible": round(
            statistics.mean([c["title_style"]["longueur_caracteres_moyenne"] for c in concurrent_jsons if c["title_style"]["longueur_caracteres_moyenne"]])
        ),
        "mots_cles_recurrents_top": [w for w, _ in kw.most_common(15)],
        "formules_structurelles_observees": formules,
    }

    reference_json = next((c for c in channel_jsons if c["role"] == "reference"), None)

    log_step("ANALYZE", "Consolidation cross-chaîne (appel Claude)...")
    client = _client()
    prompt = f"""Tu es un analyste forensique YouTube. Voici les synthèses structurées de
{len(concurrent_jsons)} chaîne(s) concurrente(s) (niche commune) :

{json.dumps(concurrent_jsons, ensure_ascii=False, indent=2)[:12000]}

Chaîne de référence (positionnement de David, pour contexte de niche uniquement — PAS à copier) :
{json.dumps(reference_json, ensure_ascii=False, indent=2)[:3000] if reference_json else "non disponible"}

Agrégats déjà calculés sur l'ensemble des chaînes concurrentes (à réutiliser tels quels) :
- Longueur de script cible (hors CTA/parasites) : {target_length_chars} caractères
- Style de titre consolidé : {json.dumps(title_style_consolidated, ensure_ascii=False)}

Rédige un pattern consolidé au format markdown, avec ces sections :
1. Squelette narratif commun (accroche/développement/chute) partagé par les chaînes concurrentes.
2. Structure des CTA type (position, formulation, ton) — à réutiliser comme gabarit, pas comme
   citation exacte.
3. Style de miniature type (composition, texte, couleurs, codes visuels du genre).
4. Style de titre type — section qui REPREND CONCRÈTEMENT les agrégats ci-dessus (casse,
   longueur cible, type d'accroche dominant, mots-clés récurrents, formules structurelles) de
   façon actionnable pour générer de nouveaux titres dans le même registre.
5. Longueur de script cible : rappelle le chiffre ci-dessus tel quel.

Rappel : ce pattern sert à générer du contenu 100% ORIGINAL (recherche propre, pas de
reformulation d'un script concurrent précis) qui suit la même structure/style, pas une copie.
"""
    resp = client.messages.create(model=MODEL, max_tokens=3000, messages=[{"role": "user", "content": prompt}])
    pattern_md = _response_text(resp)

    pattern_json = {
        "target_length_chars": target_length_chars,
        "title_style": title_style_consolidated,
        "n_concurrent_channels": len(concurrent_jsons),
        "n_concurrent_videos": len(concurrent_video_lengths),
    }
    write_json(ANALYSIS_DIR / "pattern_consolidated.json", pattern_json)
    (ANALYSIS_DIR / "pattern_consolidated.md").write_text(pattern_md, encoding="utf-8")
    log_step("ANALYZE", f"Consolidation OK — longueur cible = {target_length_chars} chars")
    return pattern_json


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Analyse forensique")
    parser.add_argument("--channel", help="slug d'une chaîne")
    parser.add_argument("--consolidate", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    if args.consolidate:
        out = consolidate_pattern(force=args.force)
    elif args.channel:
        out = analyze_channel(args.channel, force=args.force)
    else:
        parser.error("--channel <slug> ou --consolidate requis")

    print(json.dumps(out, ensure_ascii=False, indent=2))
