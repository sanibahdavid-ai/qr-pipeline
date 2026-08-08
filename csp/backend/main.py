"""FastAPI — sert l'API + le dashboard statique sur un seul port (4610)."""
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware

from backend.env_manager import bootstrap_auto_keys, read_env
from modules import analyzer, collector, generator, history
from modules.common import (
    ANALYSIS_DIR,
    CHANNELS_DIR,
    GENERATED_DIR,
    channel_analysis_dir,
    channel_video_dir,
    load_channel,
    load_channels,
    read_json,
)

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "static"

# Préfixe de chemin quand servi derrière un reverse-proxy (ex: qr-pipeline en
# Next.js fait un rewrite "/csp/:path*" -> ce service interne). Vide en local.
BASE_PATH = os.environ.get("BASE_PATH", "").rstrip("/")

# Même connexion que le reste du site (Google via Supabase) — pas de mot de
# passe séparé. Valeurs publiques (NEXT_PUBLIC_*), extraites du bundle JS
# réellement déployé de qr-pipeline pour être sûr qu'elles correspondent.
SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "https://zentofapbmyajtiawuqn.supabase.co")
SUPABASE_ANON_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_mrUEyO1esUT-9Cw0NDig_A_RJuIXFFo")

app = FastAPI(title="Clone Script Pipeline")

bootstrap_auto_keys()

_user_cache: dict[str, tuple[float, dict | None]] = {}
_USER_CACHE_TTL = 60  # secondes — évite un aller-retour Supabase à chaque appel API


def _verify_supabase_token(token: str) -> dict | None:
    """Vérifie un access token Supabase auprès de l'API Supabase (même compte
    Google que le reste du site). Retourne l'objet user si valide, None sinon."""
    now = time.time()
    cached = _user_cache.get(token)
    if cached and now - cached[0] < _USER_CACHE_TTL:
        return cached[1]
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_ANON_KEY},
            timeout=5,
        )
        user = resp.json() if resp.status_code == 200 else None
    except requests.RequestException:
        user = None
    _user_cache[token] = (now, user)
    return user


class AuthGateMiddleware(BaseHTTPMiddleware):
    """Protège les routes /api/* avec le token de session Supabase (Google)
    envoyé par le frontend en 'Authorization: Bearer <token>' — la même
    connexion que le reste du site, pas de mot de passe séparé. La page HTML
    elle-même reste publique : c'est le JS qui redirige vers le login Google
    si aucune session valide n'est trouvée."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api/") or path == "/api/_debug/supabase":
            return await call_next(request)
        auth = request.headers.get("authorization", "")
        token = auth[7:] if auth.lower().startswith("bearer ") else ""
        if not token or not _verify_supabase_token(token):
            return JSONResponse({"detail": "Non authentifié"}, status_code=401)
        return await call_next(request)


app.add_middleware(AuthGateMiddleware)


# ---------- Chaînes / collecte ----------

@app.get("/api/channels")
def api_channels():
    out = []
    for ch in load_channels():
        vdir = CHANNELS_DIR / ch["slug"] / "videos"
        n = len(list(vdir.glob("*/meta.json"))) if vdir.exists() else 0
        out.append({**ch, "n_collected": n})
    return out


@app.get("/api/channels/{slug}/videos")
def api_channel_videos(slug: str):
    try:
        load_channel(slug)
    except ValueError:
        raise HTTPException(404, "Chaîne inconnue")
    vdir = CHANNELS_DIR / slug / "videos"
    videos = []
    if vdir.exists():
        for d in vdir.iterdir():
            mp = d / "meta.json"
            if mp.exists():
                videos.append(read_json(mp))
    videos.sort(key=lambda v: v.get("rank", 999))
    return videos


@app.post("/api/channels/{slug}/collect")
def api_collect(slug: str, force: bool = False):
    try:
        return collector.collect_channel(slug, force=force)
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, f"Erreur de collecte: {e}")


@app.get("/api/thumbnail/{slug}/{video_id}")
def api_thumbnail(slug: str, video_id: str):
    path = channel_video_dir(slug, video_id) / "thumbnail.jpg"
    if not path.exists():
        raise HTTPException(404, "Miniature introuvable")
    return FileResponse(path, media_type="image/jpeg")


# ---------- Analyse ----------

@app.post("/api/channels/{slug}/analyze")
def api_analyze(slug: str, force: bool = False):
    try:
        return analyzer.analyze_channel(slug, force=force)
    except Exception as e:
        raise HTTPException(500, f"Erreur d'analyse: {e}")


@app.get("/api/channels/{slug}/analysis")
def api_get_analysis(slug: str):
    out_dir = channel_analysis_dir(slug)
    synth_json = out_dir / "synthese_chaine.json"
    synth_md = out_dir / "synthese_chaine.md"
    if not synth_json.exists():
        return {"available": False}
    videos = []
    for jf in sorted(out_dir.glob("video_*_analyse.json")):
        videos.append(read_json(jf))
    return {
        "available": True,
        "synthese_json": read_json(synth_json),
        "synthese_md": synth_md.read_text(encoding="utf-8") if synth_md.exists() else "",
        "videos": videos,
    }


@app.post("/api/consolidate")
def api_consolidate(force: bool = False):
    try:
        return analyzer.consolidate_pattern(force=force)
    except Exception as e:
        raise HTTPException(500, f"Erreur de consolidation: {e}")


@app.get("/api/pattern")
def api_get_pattern():
    json_path = ANALYSIS_DIR / "pattern_consolidated.json"
    md_path = ANALYSIS_DIR / "pattern_consolidated.md"
    if not json_path.exists():
        return {"available": False}
    return {
        "available": True,
        "pattern_json": read_json(json_path),
        "pattern_md": md_path.read_text(encoding="utf-8") if md_path.exists() else "",
    }


# ---------- Génération ----------

class GenerateRequest(BaseModel):
    subject: str
    why_now: str = ""
    force: bool = False


@app.post("/api/topics/propose")
def api_propose(n: int = 20):
    try:
        return generator.propose_topics(n)
    except Exception as e:
        raise HTTPException(500, f"Erreur de proposition: {e}")


@app.get("/api/generate/status")
def api_generate_status():
    return generator.PIPELINE_STATE


@app.get("/api/topics/latest")
def api_latest_topics():
    path = GENERATED_DIR / "proposals_latest.json"
    if not path.exists():
        return {"generated_at": None, "topics": []}
    data = read_json(path)
    for t in data.get("topics", []):
        t["already_done"] = bool(history.is_duplicate(t["subject"]))
    return data


@app.post("/api/generate")
def api_generate(req: GenerateRequest):
    try:
        return generator.generate_deliverables(req.subject, why_now=req.why_now, force=req.force)
    except generator.DuplicateSubjectError as e:
        raise HTTPException(409, str(e))
    except Exception as e:
        raise HTTPException(500, f"Erreur de génération: {e}")


class AdjustRequest(BaseModel):
    folder: str
    factor: float


@app.post("/api/adjust-length")
def api_adjust_length(req: AdjustRequest):
    try:
        return generator.adjust_script_length(req.folder, req.factor)
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, f"Erreur d'ajustement: {e}")


@app.get("/api/generated/{slug}")
def api_get_generated(slug: str):
    out_dir = GENERATED_DIR / slug
    if not out_dir.exists():
        raise HTTPException(404, "Sujet introuvable")
    return {
        "meta": read_json(out_dir / "meta.json"),
        "script": (out_dir / "script.txt").read_text(encoding="utf-8"),
        "title": (out_dir / "titre.txt").read_text(encoding="utf-8"),
        "description": (out_dir / "description.txt").read_text(encoding="utf-8"),
        "keywords": (out_dir / "mots_cles.txt").read_text(encoding="utf-8"),
        "thumbnail_prompt": (out_dir / "prompt_miniature.txt").read_text(encoding="utf-8"),
    }


@app.get("/api/history")
def api_history():
    return history.list_history()


# ---------- Réglages / statut ----------

@app.get("/api/status")
def api_status():
    env = read_env()
    return {"anthropic_key_configured": bool(env.get("ANTHROPIC_API_KEY"))}


@app.get("/api/_debug/supabase")
def debug_supabase(request: Request):
    """Diagnostic temporaire — teste la connexion sortante vers Supabase depuis
    Render (mon bac à sable local ne peut pas atteindre supabase.co pour tester).
    À retirer une fois le login Google validé de bout en bout."""
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else ""
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_ANON_KEY},
            timeout=8,
        )
        return {
            "reached_supabase": True,
            "status_code": resp.status_code,
            "body": resp.text[:500],
            "had_token": bool(token),
        }
    except requests.RequestException as e:
        return {"reached_supabase": False, "error": str(e), "had_token": bool(token)}


# ---------- Frontend statique (mono-fichier, comme health-pipeline/script-dashboard) ----------
# Route dédiée (pas un simple mount statique) pour injecter BASE_PATH dans le JS
# côté client — nécessaire pour que fetch("/api/...") vise le bon chemin une
# fois proxié derrière qr-pipeline sous /csp.

_INDEX_HTML = (STATIC_DIR / "index.html").read_text(encoding="utf-8")


@app.get("/", response_class=HTMLResponse)
def index():
    return _INDEX_HTML.replace('const API = "";', f'const API = "{BASE_PATH}";')
