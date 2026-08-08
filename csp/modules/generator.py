"""Module de génération — sujets, script/titre/description/mots-clés/prompt
miniature, 100% original (recherche propre, zéro reformulation d'un
transcript concurrent précis — cf. règle permanente d'originalité).

Deux contraintes du brief sont appliquées en CODE, pas seulement dans le
prompt Claude :
1. Longueur du script (hors CTA) = moyenne des concurrents ±500 caractères
   max -> boucle de correction automatique (`enforce_length`) qui mesure
   `len(script_body)` en Python et renvoie le texte à Claude pour
   étendre/réduire tant que la cible n'est pas atteinte (ou jusqu'à
   `max_attempts`).
2. Style de titre (casse, ton putaclic) = extrait de façon structurée par
   analyzer.py (title_style consolidé) et réinjecté ici comme contraintes
   concrètes et mesurables (casse exacte, longueur cible, type d'accroche
   dominant, mots-clés récurrents, formules structurelles observées) —
   jamais un simple "génère un titre percutant".
"""
import argparse
import json
import re
import sys

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from modules.common import (
    ANALYSIS_DIR,
    GENERATED_DIR,
    channel_analysis_dir,
    get_env,
    load_channels,
    log_step,
    now_iso,
    read_json,
    slugify,
    write_json,
)
from modules.history import is_duplicate, list_history, mark_done

MODEL = "claude-sonnet-5"
LENGTH_TOLERANCE = 500
MAX_LENGTH_ATTEMPTS = 4

# État partagé, interrogé par GET /api/generate/status pendant qu'une génération
# tourne (le POST /api/... bloque le thread qui l'exécute — cet état est ce qui
# permet au dashboard de suivre la progression en temps réel pendant ce temps).
# Même mécanisme que GENERATION_STATE dans health-pipeline/script-dashboard.
PIPELINE_STATE = {
    "active": False,
    "kind": None,       # "propose" | "generate"
    "step": "",
    "topic": None,
    "attempt": 0,
    "max_attempts": MAX_LENGTH_ATTEMPTS,
    "length": None,
    "target_min": None,
    "target_max": None,
}


def _reset_state(kind: str, topic: str | None = None):
    PIPELINE_STATE.update(
        active=True, kind=kind, step="start", topic=topic, attempt=0,
        length=None, target_min=None, target_max=None,
    )


class DuplicateSubjectError(Exception):
    pass


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


def load_pattern() -> tuple[dict, str]:
    json_path = ANALYSIS_DIR / "pattern_consolidated.json"
    md_path = ANALYSIS_DIR / "pattern_consolidated.md"
    if not json_path.exists():
        raise RuntimeError("Pattern consolidé introuvable — lance d'abord l'analyse (analyzer.consolidate_pattern).")
    return read_json(json_path), md_path.read_text(encoding="utf-8")


def all_collected_titles() -> list[str]:
    titles = []
    for ch in load_channels():
        for jf in sorted(channel_analysis_dir(ch["slug"]).glob("video_*_analyse.json")):
            titles.append(read_json(jf).get("title", ""))
    return [t for t in titles if t]


def propose_topics(n: int = 20) -> list[dict]:
    _reset_state("propose")
    PIPELINE_STATE["step"] = "pattern"
    pattern, pattern_md = load_pattern()
    titles = all_collected_titles()
    history_subjects = [e["subject"] for e in list_history()]

    prompt = f"""Tu es un veilleur éditorial pour une chaîne YouTube d'actualité géopolitique/
économique. Voici des titres de vidéos performantes observées chez des chaînes concurrentes
(niche de référence, PAS à copier) :
{json.dumps(titles, ensure_ascii=False, indent=2)}

Pattern de style consolidé de cette niche :
{pattern_md[:3000]}

Sujets déjà traités à NE PAS reproposer, même reformulés :
{json.dumps(history_subjects, ensure_ascii=False)}

Propose exactement {n} sujets NOUVEAUX, d'actualité récente, avec un vrai potentiel
"effet wahou" (retournement, chiffre choc, enjeu géopolitique/économique concret), dans le
même registre que les titres ci-dessus. Chaque sujet doit être distinct des autres proposés.

Réponds UNIQUEMENT avec un objet JSON valide :
{{"topics": [{{"subject": "sujet en une phrase, factuel et concret", "why_now": "pourquoi ce sujet est pertinent maintenant, 1 phrase"}}, ...]}}
"""
    try:
        log_step("GENERATE", f"Proposition de {n} sujets (appel Claude)...")
        PIPELINE_STATE["step"] = "claude"
        client = _client()
        resp = client.messages.create(model=MODEL, max_tokens=4000, messages=[{"role": "user", "content": prompt}])
        data = _extract_json(_response_text(resp))
        topics = data.get("topics", [])

        PIPELINE_STATE["step"] = "filtering"
        filtered = []
        for t in topics:
            if not t.get("subject"):
                continue
            if is_duplicate(t["subject"]):
                log_step("GENERATE", f"Sujet filtré (déjà traité/proche) : {t['subject'][:60]}")
                continue
            filtered.append(t)

        write_json(GENERATED_DIR / "proposals_latest.json", {"generated_at": now_iso(), "topics": filtered})
        log_step("GENERATE", f"{len(filtered)}/{len(topics)} sujets retenus après filtre anti-doublon")
        return filtered
    finally:
        PIPELINE_STATE["active"] = False


def build_generation_prompt(subject: str, why_now: str, pattern: dict, pattern_md: str) -> str:
    ts = pattern["title_style"]
    return f"""Tu es un scénariste YouTube indépendant. Crée un script 100% ORIGINAL sur le
sujet suivant, à partir d'une recherche et d'un angle propres (JAMAIS une reformulation d'un
transcript concurrent précis) — mais en respectant le squelette narratif et le registre
observés chez des chaînes concurrentes de cette niche.

SUJET : {subject}
Pourquoi maintenant : {why_now}

LANGUE OBLIGATOIRE : ANGLAIS pour tous les champs de sortie (title, script_body, cta_25,
cta_100, description, keywords, thumbnail_prompt) — les chaînes concurrentes analysées sont
toutes en anglais, donc la sortie doit l'être aussi, MÊME SI le sujet ci-dessus est formulé
en français.

PATTERN CONSOLIDÉ (squelette narratif, CTA type, miniature type) — à suivre comme structure,
pas comme contenu à copier :
{pattern_md[:4000]}

STYLE DE TITRE OBLIGATOIRE — contraintes mesurables, à respecter strictement (dérivées d'une
analyse structurée des titres concurrents, pas une consigne vague) :
- Casse à reproduire : {ts.get('casse_dominante', 'Mixed')}
- Longueur cible du titre : ~{ts.get('longueur_caracteres_cible', 80)} caractères
- Type d'accroche dominant à utiliser : {ts.get('type_accroche_dominant', 'urgence')}
- Mots-clés à privilégier SI pertinents pour ce sujet précis : {', '.join(ts.get('mots_cles_recurrents_top', [])[:10])}
- S'inspirer du RYTHME de ces formules structurelles observées chez les concurrents, sans
  reprendre une formule mot pour mot :
{chr(10).join('  - ' + f for f in ts.get('formules_structurelles_observees', [])[:6])}

CONTRAINTES SCRIPT :
- "script_body" = narration pure, prête pour voix off. AUCUNE CTA dedans (les CTA sont générées
  à part, champs séparés). AUCUN marqueur de scène, AUCUN titre/heading inline.
- Vise environ {pattern['target_length_chars']} caractères pour "script_body" (un contrôle
  automatique va mesurer et corriger si besoin — vise cette longueur directement, ne la
  résume pas artificiellement).
- Zéro plagiat, conforme aux règles YouTube (pas d'affirmation trompeuse présentée comme un
  fait vérifié sans nuance).

CONTRAINTES CTA (séparées, PAS dans script_body) :
- "cta_25" : sera inséré vers 25% de la vidéo. "cta_100" : sera ajouté à la toute fin.
- Max 2 phrases chacun, très courts, ton sensible qui valorise le travail de recherche/
  vérification derrière la vidéo (pas transactionnel, pas générique "like and subscribe").

Réponds UNIQUEMENT avec un objet JSON valide, exactement ce format :
{{
  "title": "...",
  "script_body": "...",
  "cta_25": "...",
  "cta_100": "...",
  "description": "...",
  "keywords": ["...", "..."],
  "thumbnail_prompt": "description texte uniquement (composition/texte overlay/couleurs/expressions), inspirée du style observé, PAS une reproduction d'une miniature concurrente précise"
}}
"""


def truncate_to_sentence(text: str, max_len: int) -> str:
    """Coupe déterministement à la dernière limite de phrase avant max_len.
    Convergent en un seul passage, contrairement à une réécriture LLM libre."""
    if len(text) <= max_len:
        return text
    window = text[:max_len]
    boundaries = list(re.finditer(r"[.!?](?=\s|$)", window))
    if boundaries:
        return text[: boundaries[-1].end()].rstrip()
    return window.rstrip()


def enforce_length(client, script_body: str, target_min: int, target_max: int) -> tuple[str, list[dict], bool]:
    """Boucle de correction automatique en code (pas seulement dans le prompt) :
    - Trop long -> troncature déterministe à la limite de phrase la plus proche de la
      cible (Python pur, convergent en un passage, aucun appel API).
    - Trop court -> une extension ciblée par appel Claude (section développement
      uniquement, accroche/chute intouchées), avec le delta exact recalculé à chaque
      tentative sur la longueur réellement mesurée.
    Une réécriture libre en boucle (essayée initialement) oscillait sans converger —
    cette version déterministe pour le cas "trop long" (le plus fréquent) élimine le
    problème."""
    attempts_log = []
    PIPELINE_STATE.update(step="length_check", target_min=target_min, target_max=target_max)
    for attempt in range(1, MAX_LENGTH_ATTEMPTS + 1):
        length = len(script_body)
        attempts_log.append({"attempt": attempt, "length": length})
        PIPELINE_STATE.update(attempt=attempt, length=length)
        if target_min <= length <= target_max:
            return script_body, attempts_log, True

        if length > target_max:
            log_step("GENERATE", f"Longueur {length} > cible max {target_max} — troncature déterministe #{attempt}")
            PIPELINE_STATE["step"] = "length_truncate"
            script_body = truncate_to_sentence(script_body, target_max)
            PIPELINE_STATE["step"] = "length_check"
            continue

        if attempt == MAX_LENGTH_ATTEMPTS:
            break
        delta = target_min - length
        log_step("GENERATE", f"Longueur {length} < cible min {target_min} — extension ciblée #{attempt} (+{delta} chars)")
        PIPELINE_STATE["step"] = "length_extend"
        prompt = f"""Voici un script de {length} caractères. La cible minimale est {target_min}
caractères (maximum {target_max}). Ajoute environ {delta} caractères de détail factuel,
d'exemples ou de contexte SUPPLÉMENTAIRE, UNIQUEMENT dans la section développement (le corps
du script, pas l'accroche ni la chute). Ne raccourcis et ne supprime AUCUN passage existant —
tu ne fais qu'ajouter du contenu. Garde le même sujet, les mêmes faits, le même ton.

Script actuel :
---
{script_body}
---

Réponds UNIQUEMENT avec le texte complet du script (accroche + développement étendu + chute),
pas de JSON, pas de commentaire, pas de guillemets englobants, pas de titre."""
        resp = client.messages.create(model=MODEL, max_tokens=12000, messages=[{"role": "user", "content": prompt}])
        script_body = _response_text(resp).strip()
        PIPELINE_STATE["step"] = "length_check"

    length = len(script_body)
    if length > target_max:
        script_body = truncate_to_sentence(script_body, target_max)
        length = len(script_body)
    ok = target_min <= length <= target_max
    attempts_log.append({"attempt": len(attempts_log) + 1, "length": length})
    if not ok:
        log_step("GENERATE", f"Longueur finale {length} toujours hors cible après {MAX_LENGTH_ATTEMPTS} tentatives — conservé tel quel (voir meta.json)")
    return script_body, attempts_log, ok


def insert_ctas(script_body: str, cta_25: str, cta_100: str) -> str:
    target_pos = int(len(script_body) * 0.25)
    m = re.search(r"[.!?]\s+", script_body[target_pos:])
    insert_at = target_pos + m.end() if m else target_pos
    before = script_body[:insert_at].rstrip()
    after = script_body[insert_at:].lstrip()
    full = f"{before}\n\n{cta_25}\n\n{after}".rstrip()
    return f"{full}\n\n{cta_100}"


def generate_deliverables(subject: str, why_now: str = "", force: bool = False) -> dict:
    if not force:
        dup = is_duplicate(subject)
        if dup:
            raise DuplicateSubjectError(
                f"Sujet déjà traité le {dup.get('date', '?')} : « {dup.get('title', subject)} »"
            )

    _reset_state("generate", topic=subject)
    try:
        pattern, pattern_md = load_pattern()
        target = pattern["target_length_chars"]
        target_min, target_max = target - LENGTH_TOLERANCE, target + LENGTH_TOLERANCE
        PIPELINE_STATE.update(target_min=target_min, target_max=target_max)

        client = _client()
        log_step("GENERATE", f"Génération du script pour : {subject[:70]}")
        PIPELINE_STATE["step"] = "script"
        prompt = build_generation_prompt(subject, why_now, pattern, pattern_md)
        resp = client.messages.create(model=MODEL, max_tokens=16000, messages=[{"role": "user", "content": prompt}])
        data = _extract_json(_response_text(resp))

        script_body, attempts, length_ok = enforce_length(client, data["script_body"], target_min, target_max)
        PIPELINE_STATE["step"] = "saving"
        final_script = insert_ctas(script_body, data["cta_25"], data["cta_100"])

        slug = slugify(subject)
        out_dir = GENERATED_DIR / slug
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "script.txt").write_text(final_script, encoding="utf-8")
        (out_dir / "script_body_raw.txt").write_text(script_body, encoding="utf-8")
        (out_dir / "titre.txt").write_text(data["title"], encoding="utf-8")
        (out_dir / "description.txt").write_text(data["description"], encoding="utf-8")
        (out_dir / "mots_cles.txt").write_text("\n".join(data.get("keywords", [])), encoding="utf-8")
        (out_dir / "prompt_miniature.txt").write_text(data["thumbnail_prompt"], encoding="utf-8")

        meta = {
            "subject": subject,
            "title": data["title"],
            "cta_25": data["cta_25"],
            "cta_100": data["cta_100"],
            "target_length_chars": target,
            "target_range": [target_min, target_max],
            "final_script_body_length": len(script_body),
            "length_ok": length_ok,
            "length_attempts": attempts,
            "folder": slug,
            "created": now_iso(),
        }
        write_json(out_dir / "meta.json", meta)
        mark_done(subject, data["title"], slug)
        log_step("GENERATE", f"OK — {slug} (longueur finale {len(script_body)} chars, cible atteinte: {length_ok})")
        PIPELINE_STATE["step"] = "done"
        return meta
    finally:
        PIPELINE_STATE["active"] = False


def adjust_script_length(folder: str, factor: float) -> dict:
    """Ajuste manuellement la longueur d'un script déjà généré (réduire de moitié /
    doubler / tout facteur) — même moteur que la génération initiale (enforce_length),
    appliqué à une nouvelle cible = longueur actuelle x factor. N'affecte pas
    l'historique anti-doublon (même sujet, juste une nouvelle version du script)."""
    out_dir = GENERATED_DIR / folder
    raw_path = out_dir / "script_body_raw.txt"
    if not out_dir.exists() or not raw_path.exists():
        raise ValueError(f"Sujet introuvable ou incomplet: {folder}")
    meta = read_json(out_dir / "meta.json")
    script_body = raw_path.read_text(encoding="utf-8")

    new_target = max(1000, round(len(script_body) * factor))
    target_min, target_max = new_target - LENGTH_TOLERANCE, new_target + LENGTH_TOLERANCE

    _reset_state("adjust", topic=meta.get("subject"))
    try:
        client = _client()
        log_step("GENERATE", f"Ajustement {folder} — facteur {factor} (cible {new_target} chars)")
        script_body, attempts, length_ok = enforce_length(client, script_body, target_min, target_max)
        PIPELINE_STATE["step"] = "saving"
        final_script = insert_ctas(script_body, meta["cta_25"], meta["cta_100"])

        (out_dir / "script.txt").write_text(final_script, encoding="utf-8")
        (out_dir / "script_body_raw.txt").write_text(script_body, encoding="utf-8")

        meta["target_length_chars"] = new_target
        meta["target_range"] = [target_min, target_max]
        meta["final_script_body_length"] = len(script_body)
        meta["length_ok"] = length_ok
        meta["length_attempts"] = attempts
        write_json(out_dir / "meta.json", meta)
        log_step("GENERATE", f"Ajustement OK — {folder} (longueur finale {len(script_body)} chars)")
        PIPELINE_STATE["step"] = "done"
        return meta
    finally:
        PIPELINE_STATE["active"] = False


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Génération de sujets/scripts")
    parser.add_argument("--propose", type=int, help="Propose N sujets")
    parser.add_argument("--generate", help="Génère les livrables pour ce sujet (texte exact)")
    parser.add_argument("--why-now", default="")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    if args.propose:
        out = propose_topics(args.propose)
    elif args.generate:
        out = generate_deliverables(args.generate, why_now=args.why_now, force=args.force)
    else:
        parser.error("--propose N ou --generate <sujet> requis")

    print(json.dumps(out, ensure_ascii=False, indent=2))
