"""FastAPI — sert l'API + le dashboard statique sur un seul port (4610)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.sessions import SessionMiddleware

from backend.env_manager import bootstrap_auto_keys, mask_key, read_env
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

import os

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "static"

# Préfixe de chemin quand servi derrière un reverse-proxy (ex: qr-pipeline en
# Next.js fait un rewrite "/csp/:path*" -> ce service interne). Vide en local.
BASE_PATH = os.environ.get("BASE_PATH", "").rstrip("/")

app = FastAPI(title="Clone Script Pipeline")

boot_result = bootstrap_auto_keys()
if boot_result.get("DASHBOARD_PASSWORD_GENERATED"):
    print(
        "=" * 60
        + f"\nMot de passe du dashboard généré : {boot_result['DASHBOARD_PASSWORD_GENERATED']}"
        + "\n(sauvegardé dans .env — DASHBOARD_PASSWORD — ne sera plus réaffiché)"
        + "\n" + "=" * 60,
        flush=True,
    )


LOGIN_PAGE = """<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connexion — Clone Script Pipeline</title>
<style>
  body {{ margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:#0b1220; color:#e8edf7; font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif; }}
  form {{ background:#111a2e; border:1px solid #22314f; border-radius:14px; padding:32px; width:280px; }}
  h1 {{ font-size:16px; margin:0 0 18px; }}
  input {{ width:100%; background:#16213a; border:1px solid #22314f; color:#e8edf7;
    border-radius:8px; padding:11px 12px; font-size:14px; box-sizing:border-box; margin-bottom:12px; }}
  button {{ width:100%; background:#4fc3f7; color:#04121f; border:none; border-radius:8px;
    padding:11px; font-size:14px; font-weight:700; cursor:pointer; }}
  .err {{ color:#ef5350; font-size:13px; margin-bottom:12px; }}
</style></head><body>
<form method="post" action="{base_path}/login">
  <h1>Clone Script Pipeline</h1>
  {error_html}
  <input type="password" name="password" placeholder="Mot de passe" autofocus required>
  <button type="submit">Entrer</button>
</form>
</body></html>"""


@app.get("/login", response_class=HTMLResponse)
def login_form():
    return LOGIN_PAGE.format(error_html="", base_path=BASE_PATH)


@app.post("/login")
def login_submit(request: Request, password: str = Form(...)):
    if password == read_env().get("DASHBOARD_PASSWORD"):
        request.session["authenticated"] = True
        return RedirectResponse(BASE_PATH + "/", status_code=303)
    return HTMLResponse(
        LOGIN_PAGE.format(error_html='<div class="err">Mot de passe incorrect.</div>', base_path=BASE_PATH),
        status_code=401,
    )


@app.get("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse(BASE_PATH + "/login", status_code=303)


class AuthGateMiddleware(BaseHTTPMiddleware):
    """Protège tout le dashboard derrière un mot de passe unique (DASHBOARD_PASSWORD).
    Nécessaire dès que le site n'est plus juste en local (127.0.0.1) : sans ça,
    n'importe qui avec l'URL pourrait déclencher des générations (coût API) ou
    voir l'analyse concurrentielle."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if path == "/login" or path.startswith("/favicon"):
            return await call_next(request)
        if request.session.get("authenticated"):
            return await call_next(request)
        if path.startswith("/api/"):
            return JSONResponse({"detail": "Non authentifié"}, status_code=401)
        return RedirectResponse(BASE_PATH + "/login")


app.add_middleware(AuthGateMiddleware)
app.add_middleware(
    SessionMiddleware,
    secret_key=read_env().get("SESSION_SECRET"),
    same_site="lax",
    max_age=60 * 60 * 24 * 30,
)


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
    return {"anthropic_key_configured": bool(env.get("ANTHROPIC_API_KEY")), "port": env.get("DASHBOARD_PORT", "4610")}


# ---------- Frontend statique (mono-fichier, comme health-pipeline/script-dashboard) ----------
# Route dédiée (pas un simple mount statique) pour injecter BASE_PATH dans le JS
# côté client — nécessaire pour que fetch("/api/...") vise le bon chemin une
# fois proxié derrière qr-pipeline sous /csp.

_INDEX_HTML = (STATIC_DIR / "index.html").read_text(encoding="utf-8")


@app.get("/", response_class=HTMLResponse)
def index():
    return _INDEX_HTML.replace('const API = "";', f'const API = "{BASE_PATH}";')
