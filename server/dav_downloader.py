"""
DAV DOWNLOADER - Backend Server
Runs on port 5757 (internal). Proxied through Next.js on Railway.
"""

from pathlib import Path as _Path
from dotenv import load_dotenv
load_dotenv(dotenv_path=_Path(__file__).parent.parent / ".env.render")

import subprocess
import os
import re
import json as _json
import threading
import time
import uuid
from pathlib import Path

import boto3
from botocore.config import Config as BotoConfig
from flask import Flask, request, jsonify, Response, stream_with_context, redirect as flask_redirect
from flask_cors import CORS

# ── Config ────────────────────────────────────────────────────────────────────
DOWNLOAD_FOLDER = Path(os.environ.get("DOWNLOAD_DIR", "/tmp/downloads"))
DOWNLOAD_FOLDER.mkdir(parents=True, exist_ok=True)

PORT = int(os.environ.get("FLASK_PORT", 5757))

app = Flask(__name__)
CORS(app)

history = []

# ── ffmpeg: use imageio-ffmpeg's static binary so merging works on Render ─────
try:
    import imageio_ffmpeg
    FFMPEG_PATH = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    FFMPEG_PATH = "ffmpeg"  # fall back to system PATH

# ── R2 / S3-compatible storage ─────────────────────────────────────────────────
R2_BUCKET = os.environ.get("R2_BUCKET", "dav-downloads")
R2_EXPIRY = 3600  # presigned URL TTL and cleanup age in seconds

_r2_client = None
_r2_lock   = threading.Lock()
_r2_keys: dict = {}        # {r2_key: expiry_epoch}
_redirect_keys: dict = {}  # {token: {"url": presigned_url, "expires": epoch}}


def _get_r2():
    global _r2_client
    if _r2_client is None:
        ep  = os.environ.get("R2_ENDPOINT")
        kid = os.environ.get("R2_ACCESS_KEY_ID")
        sec = os.environ.get("R2_SECRET_ACCESS_KEY")
        if ep and kid and sec:
            _r2_client = boto3.client(
                "s3",
                endpoint_url=ep,
                aws_access_key_id=kid,
                aws_secret_access_key=sec,
                config=BotoConfig(signature_version="s3v4"),
                region_name="auto",
            )
    return _r2_client


def _cleanup_worker():
    """Deletes R2 objects and redirect tokens whose TTL has expired (runs every 10 min)."""
    while True:
        time.sleep(600)
        now = time.time()
        # Clean redirect tokens
        expired_tokens = [t for t, v in list(_redirect_keys.items()) if now > v["expires"]]
        for t in expired_tokens:
            _redirect_keys.pop(t, None)
        # Clean R2 objects
        r2 = _get_r2()
        if not r2:
            continue
        with _r2_lock:
            expired = [k for k, exp in list(_r2_keys.items()) if now > exp]
        for key in expired:
            try:
                r2.delete_object(Bucket=R2_BUCKET, Key=key)
            except Exception:
                pass
            with _r2_lock:
                _r2_keys.pop(key, None)


threading.Thread(target=_cleanup_worker, daemon=True).start()


def upload_to_r2(local_path: Path) -> str:
    """Upload file to R2, register it for cleanup, return 1-hour presigned URL."""
    r2 = _get_r2()
    if not r2:
        raise RuntimeError("R2 credentials not configured")
    filename = local_path.name
    key = f"{uuid.uuid4().hex}/{filename}"
    r2.upload_file(str(local_path), R2_BUCKET, key)
    with _r2_lock:
        _r2_keys[key] = time.time() + R2_EXPIRY
    return r2.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": R2_BUCKET,
            "Key": key,
            "ResponseContentDisposition": f'attachment; filename="{filename}"',
        },
        ExpiresIn=R2_EXPIRY,
    )

# ── Helpers ───────────────────────────────────────────────────────────────────
def build_video_format_string(quality: str) -> str:
    if quality in ("1080", "720", "480", "360"):
        return (f"bestvideo[height<={quality}][ext=mp4]+bestaudio[ext=m4a]"
                f"/best[height<={quality}][ext=mp4]/best[height<={quality}]")
    return "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"


def _find_downloaded_file(hint: str) -> Path | None:
    """Locate the file yt-dlp produced: try exact name first, then newest in folder."""
    candidate = DOWNLOAD_FOLDER / hint
    if candidate.exists():
        return candidate
    files = sorted(
        [f for f in DOWNLOAD_FOLDER.iterdir() if f.is_file()],
        key=lambda p: p.stat().st_mtime, reverse=True,
    )
    return files[0] if files else None

# ── Routes ────────────────────────────────────────────────────────────────────
@app.route("/ping")
def ping():
    return jsonify({
        "status": "ok",
        "r2": _get_r2() is not None,
        "ffmpeg": FFMPEG_PATH,
        "folder": str(DOWNLOAD_FOLDER),
    })


@app.route("/download", methods=["POST"])
def download():
    data = request.json
    url = data.get("url", "").strip()
    format_choice = data.get("format", "video")

    if not url:
        return jsonify({"success": False, "error": "URL vide"}), 400

    quality = data.get("quality", "best")
    output_template = str(DOWNLOAD_FOLDER / "%(title)s.%(ext)s")

    if format_choice == "audio":
        cmd = [
            "yt-dlp", "-x", "--audio-format", "mp3",
            "--ffmpeg-location", FFMPEG_PATH,
            "-o", output_template, "--no-playlist", url,
        ]
    else:
        cmd = [
            "yt-dlp",
            "-f", build_video_format_string(quality),
            "--merge-output-format", "mp4",
            "--ffmpeg-location", FFMPEG_PATH,
            "-o", output_template, "--no-playlist", url,
        ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode == 0:
            lines = result.stdout.strip().split("\n")
            filename = "download"
            for line in lines:
                if "[Merger]" in line and "Merging formats into" in line:
                    filename = line.split('"')[1].split("/")[-1].split("\\")[-1]
                    break
                elif "[download] Destination:" in line:
                    filename = line.split("Destination:")[-1].strip().split("/")[-1].split("\\")[-1]
            entry = {"url": url, "filename": filename, "format": format_choice, "status": "success"}
            history.insert(0, entry)
            if len(history) > 20:
                history.pop()
            return jsonify({"success": True, "filename": filename})
        else:
            return jsonify({"success": False, "error": result.stderr[-500:]}), 500
    except subprocess.TimeoutExpired:
        return jsonify({"success": False, "error": "Timeout — vidéo trop longue ou connexion lente"}), 500
    except FileNotFoundError:
        return jsonify({"success": False, "error": "yt-dlp introuvable"}), 500
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/download-stream", methods=["POST"])
def download_stream():
    data = request.json
    url = data.get("url", "").strip()
    format_choice = data.get("format", "video")

    if not url:
        def err_gen():
            yield 'data: {"type":"error","message":"URL vide"}\n\n'
        return Response(stream_with_context(err_gen()), mimetype="text/event-stream")

    quality = data.get("quality", "best")
    output_template = str(DOWNLOAD_FOLDER / "%(title)s.%(ext)s")

    if format_choice == "audio":
        cmd = [
            "yt-dlp", "-x", "--audio-format", "mp3",
            "--ffmpeg-location", FFMPEG_PATH,
            "-o", output_template, "--no-playlist", "--newline", url,
        ]
    else:
        cmd = [
            "yt-dlp",
            "-f", build_video_format_string(quality),
            "--merge-output-format", "mp4",
            "--ffmpeg-location", FFMPEG_PATH,
            "-o", output_template, "--no-playlist", "--newline", url,
        ]

    def generate():
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True, bufsize=1,
                encoding="utf-8", errors="replace",
            )
            filename = "download"

            for raw_line in iter(proc.stdout.readline, ""):
                line = raw_line.rstrip()
                if not line:
                    continue
                m = re.search(r'\[download\]\s+([\d.]+)%', line)
                if m:
                    pct = round(float(m.group(1)), 1)
                    yield f'data: {{"type":"progress","percent":{pct}}}\n\n'
                if "[Merger]" in line and "Merging formats into" in line:
                    try:
                        filename = line.split('"')[1].split("/")[-1].split("\\")[-1]
                    except Exception:
                        pass
                elif "[download] Destination:" in line:
                    filename = line.split("Destination:")[-1].strip().split("/")[-1].split("\\")[-1]

            proc.stdout.close()
            proc.wait()

            if proc.returncode != 0:
                yield f'data: {{"type":"done","success":false,"error":"Téléchargement échoué (code {proc.returncode})"}}\n\n'
                return

            # Locate the file yt-dlp wrote
            local_file = _find_downloaded_file(filename)
            if local_file is None:
                yield 'data: {"type":"done","success":false,"error":"Fichier introuvable après téléchargement"}\n\n'
                return

            filename = local_file.name
            entry = {"url": url, "filename": filename, "format": format_choice, "status": "success"}
            history.insert(0, entry)
            if len(history) > 20:
                history.pop()

            # Upload to R2 and send presigned URL
            yield f'data: {{"type":"uploading","message":"Envoi vers R2…"}}\n\n'
            try:
                presigned_url = upload_to_r2(local_file)
                local_file.unlink(missing_ok=True)
                # Store a same-origin redirect token so the iframe can trigger
                # the download without hitting cross-origin restrictions on the
                # presigned URL directly.
                token = uuid.uuid4().hex
                _redirect_keys[token] = {"url": presigned_url, "expires": time.time() + R2_EXPIRY}
                yield (f'data: {{"type":"done","success":true,'
                       f'"filename":{_json.dumps(filename)},'
                       f'"redirect_key":{_json.dumps(token)}}}\n\n')
            except Exception as exc:
                local_file.unlink(missing_ok=True)
                yield f'data: {{"type":"done","success":false,"error":{_json.dumps("Upload R2: " + str(exc))}}}\n\n'

        except FileNotFoundError:
            yield 'data: {"type":"done","success":false,"error":"yt-dlp introuvable"}\n\n'
        except Exception as exc:
            yield f'data: {{"type":"done","success":false,"error":{_json.dumps(str(exc))}}}\n\n'

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/history")
def get_history():
    return jsonify(history)


@app.route("/test-r2")
def test_r2():
    """Diagnostic: upload a 1-byte file to R2 and return the presigned URL or full error."""
    r2 = _get_r2()
    if not r2:
        return jsonify({"ok": False, "error": "R2 client not initialised — check env vars"}), 500
    import tempfile
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".txt") as f:
            f.write(b"ping")
            tmp = Path(f.name)
        key = f"test/{uuid.uuid4().hex}.txt"
        r2.upload_file(str(tmp), R2_BUCKET, key)
        tmp.unlink(missing_ok=True)
        url = r2.generate_presigned_url(
            "get_object",
            Params={"Bucket": R2_BUCKET, "Key": key},
            ExpiresIn=300,
        )
        r2.delete_object(Bucket=R2_BUCKET, Key=key)
        return jsonify({"ok": True, "bucket": R2_BUCKET, "presigned_url": url})
    except Exception as exc:
        return jsonify({"ok": False, "bucket": R2_BUCKET, "error": str(exc)}), 500


@app.route("/redirect/<token>")
def redirect_to_r2(token):
    """Same-origin redirect to the R2 presigned URL so iframe downloads work."""
    entry = _redirect_keys.get(token)
    if not entry or time.time() > entry["expires"]:
        return jsonify({"error": "Lien expiré ou invalide"}), 404
    return flask_redirect(entry["url"], code=302)


@app.route("/stream-download")
def stream_download():
    """Fallback: pipe yt-dlp stdout directly to browser (no R2, no merging)."""
    url = request.args.get("url", "").strip()
    format_choice = request.args.get("format", "video")
    quality = request.args.get("quality", "best")

    if not url:
        return jsonify({"error": "URL vide"}), 400

    is_audio = format_choice == "audio"
    if is_audio:
        cmd = ["yt-dlp", "-x", "--audio-format", "mp3",
               "--ffmpeg-location", FFMPEG_PATH,
               "-o", "-", "--no-playlist", url]
        filename = "audio.mp3"
        content_type = "audio/mpeg"
    else:
        if quality in ("1080", "720", "480", "360"):
            fmt = (f"best[height<={quality}][ext=mp4]"
                   f"/best[height<={quality}]/best[ext=mp4]/best")
        else:
            fmt = "best[ext=mp4]/best"
        cmd = ["yt-dlp", "-f", fmt, "--ffmpeg-location", FFMPEG_PATH,
               "-o", "-", "--no-playlist", url]
        filename = "video.mp4"
        content_type = "video/mp4"

    def generate():
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            while True:
                chunk = proc.stdout.read(65536)
                if not chunk:
                    break
                yield chunk
            proc.stdout.close()
            proc.wait()
        except Exception:
            return

    return Response(
        stream_with_context(generate()),
        mimetype=content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
        },
    )


@app.route("/app")
def serve_app():
    html = r"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DAV DOWNLOAD</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@700;800&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0a0a0f;
    --surface: #111118;
    --border: #1e1e2e;
    --accent: #00e5ff;
    --accent2: #ff3cac;
    --text: #e0e0f0;
    --muted: #555577;
    --success: #00ffaa;
    --error: #ff4466;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Space Mono', monospace;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    overflow-x: hidden;
  }

  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background-image:
      linear-gradient(var(--border) 1px, transparent 1px),
      linear-gradient(90deg, var(--border) 1px, transparent 1px);
    background-size: 40px 40px;
    opacity: 0.4;
    pointer-events: none;
  }

  .container {
    width: 100%;
    max-width: 640px;
    position: relative;
    z-index: 1;
  }

  .header {
    margin-bottom: 2.5rem;
    text-align: center;
  }

  .logo {
    font-family: 'Syne', sans-serif;
    font-size: 3rem;
    font-weight: 800;
    letter-spacing: -2px;
    line-height: 1;
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .tagline {
    font-size: 0.7rem;
    color: var(--muted);
    letter-spacing: 4px;
    text-transform: uppercase;
    margin-top: 0.4rem;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 2rem;
    margin-bottom: 1.5rem;
    position: relative;
    overflow: hidden;
  }

  .card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 2px;
    background: linear-gradient(90deg, var(--accent), var(--accent2));
  }

  .input-label {
    font-size: 0.65rem;
    color: var(--muted);
    letter-spacing: 3px;
    text-transform: uppercase;
    margin-bottom: 0.75rem;
    display: block;
  }

  .input-row {
    display: flex;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: 2px;
    overflow: hidden;
    transition: border-color 0.2s;
  }

  .input-row:focus-within {
    border-color: var(--accent);
  }

  #urlInput {
    flex: 1;
    background: #0d0d15;
    border: none;
    outline: none;
    color: var(--text);
    font-family: 'Space Mono', monospace;
    font-size: 0.82rem;
    padding: 0.9rem 1rem;
  }

  #urlInput::placeholder { color: var(--muted); }

  .paste-btn {
    background: var(--border);
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 0 1rem;
    font-family: 'Space Mono', monospace;
    font-size: 0.7rem;
    letter-spacing: 1px;
    transition: all 0.15s;
  }

  .paste-btn:hover {
    background: var(--accent);
    color: #000;
  }

  .platform-badge {
    display: none;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.55rem;
    padding: 0.22rem 0.65rem 0.22rem 0.35rem;
    border-radius: 20px;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.5px;
    border: 1px solid transparent;
    width: fit-content;
    animation: fadeIn 0.2s ease;
    transition: opacity 0.2s;
  }

  .platform-badge svg {
    flex-shrink: 0;
    border-radius: 3px;
  }

  .format-row {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .fmt-btn {
    flex: 1;
    padding: 0.6rem;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted);
    font-family: 'Space Mono', monospace;
    font-size: 0.72rem;
    letter-spacing: 2px;
    text-transform: uppercase;
    cursor: pointer;
    border-radius: 2px;
    transition: all 0.15s;
  }

  .fmt-btn.active {
    border-color: var(--accent);
    color: var(--accent);
    background: rgba(0, 229, 255, 0.06);
  }

  .quality-row {
    margin-top: 0.75rem;
  }

  .quality-select {
    width: 100%;
    background: #0d0d15;
    border: 1px solid var(--border);
    color: var(--text);
    font-family: 'Space Mono', monospace;
    font-size: 0.72rem;
    letter-spacing: 1px;
    padding: 0.6rem 2rem 0.6rem 0.75rem;
    border-radius: 2px;
    outline: none;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6' fill='%23555577'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.75rem center;
    transition: border-color 0.15s;
  }

  .quality-select:focus {
    border-color: var(--accent);
  }

  .quality-select option {
    background: #0d0d15;
    color: var(--text);
  }

  .dl-btn {
    width: 100%;
    margin-top: 1.25rem;
    padding: 1rem;
    background: linear-gradient(135deg, var(--accent), #0077ff);
    border: none;
    color: #000;
    font-family: 'Syne', sans-serif;
    font-weight: 800;
    font-size: 1rem;
    letter-spacing: 3px;
    text-transform: uppercase;
    cursor: pointer;
    border-radius: 2px;
    transition: all 0.2s;
    position: relative;
    overflow: hidden;
  }

  .dl-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 8px 30px rgba(0, 229, 255, 0.3);
  }

  .dl-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .progress-bar {
    height: 28px;
    background: rgba(30, 30, 46, 0.9);
    margin-top: 1rem;
    border-radius: 3px;
    overflow: hidden;
    display: none;
    position: relative;
    border: 1px solid var(--border);
  }

  .progress-bar.active { display: block; }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--accent2));
    width: 0%;
    transition: width 0.4s ease;
  }

  .progress-label {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.95);
    letter-spacing: 1px;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
    pointer-events: none;
  }

  .status {
    margin-top: 1rem;
    padding: 0.75rem 1rem;
    border-radius: 2px;
    font-size: 0.78rem;
    display: none;
    line-height: 1.5;
  }

  .status.success {
    display: block;
    background: rgba(0, 255, 170, 0.08);
    border: 1px solid var(--success);
    color: var(--success);
  }

  .status.error {
    display: block;
    background: rgba(255, 68, 102, 0.08);
    border: 1px solid var(--error);
    color: var(--error);
  }

  .history-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }

  .section-title {
    font-size: 0.65rem;
    color: var(--muted);
    letter-spacing: 3px;
    text-transform: uppercase;
  }

  #historyList { list-style: none; }

  #historyList li {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.75rem;
    color: var(--muted);
    animation: fadeIn 0.3s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  #historyList li:last-child { border-bottom: none; }

  .hist-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--success);
    flex-shrink: 0;
  }

  .hist-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }

  .hist-fmt {
    font-size: 0.6rem;
    padding: 0.15rem 0.4rem;
    border: 1px solid var(--border);
    border-radius: 20px;
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .empty-history {
    text-align: center;
    padding: 1.5rem;
    color: var(--muted);
    font-size: 0.72rem;
    letter-spacing: 2px;
  }
</style>
</head>
<body>

<div class="container">
  <div class="header">
    <div class="logo">DAV DOWNLOAD</div>
    <div class="tagline">colle le lien — récupère la vidéo</div>
  </div>

  <div class="card">
    <label class="input-label">URL de la vidéo</label>
    <div class="input-row">
      <input type="text" id="urlInput" placeholder="https://youtube.com/watch?v=...">
      <button class="paste-btn" onclick="pasteURL()">COLLER</button>
    </div>

    <div class="platform-badge" id="platformBadge"></div>

    <div class="format-row">
      <button class="fmt-btn active" id="fmtVideo" onclick="setFormat('video')">▶ Vidéo MP4</button>
      <button class="fmt-btn" id="fmtAudio" onclick="setFormat('audio')">♪ Audio MP3</button>
    </div>

    <div class="quality-row" id="qualityRow">
      <select id="qualitySelect" class="quality-select">
        <option value="best">Meilleure qualité</option>
        <option value="1080">1080p</option>
        <option value="720">720p</option>
        <option value="480">480p</option>
        <option value="360">360p</option>
      </select>
    </div>

    <button class="dl-btn" id="dlBtn" onclick="startDownload()">TÉLÉCHARGER</button>

    <div class="progress-bar" id="progressBar">
      <div class="progress-fill" id="progressFill"></div>
      <div class="progress-label" id="progressLabel">0%</div>
    </div>

    <div class="status" id="statusMsg"></div>
  </div>

  <div class="card">
    <div class="history-header">
      <span class="section-title">Historique</span>
    </div>
    <ul id="historyList">
      <li><div class="empty-history">Aucun téléchargement cette session</div></li>
    </ul>
  </div>
</div>

<script>
  let format = 'video';

  const PLATFORMS = [
    {
      name: 'YouTube',
      regex: /youtube\.com|youtu\.be/i,
      bg: '#FF0000', labelColor: '#FF0000',
      icon: '<path d="M9.5 7.5l7 4.5-7 4.5z" fill="white"/>'
    },
    {
      name: 'TikTok',
      regex: /tiktok\.com/i,
      bg: '#010101', labelColor: '#69C9D0',
      icon: '<text x="12" y="17.5" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="14">♪</text>'
    },
    {
      name: 'Instagram',
      regex: /instagram\.com/i,
      bg: '#C13584', labelColor: '#C13584',
      icon: '<rect x="7.5" y="7.5" width="9" height="9" rx="2.5" fill="none" stroke="white" stroke-width="1.5"/><circle cx="12" cy="12" r="2.3" fill="none" stroke="white" stroke-width="1.5"/><circle cx="15.5" cy="8.5" r="0.9" fill="white"/>'
    },
    {
      name: 'X / Twitter',
      regex: /twitter\.com|x\.com/i,
      bg: '#000000', labelColor: '#888',
      icon: '<line x1="7" y1="7" x2="17" y2="17" stroke="white" stroke-width="2.5" stroke-linecap="round"/><line x1="17" y1="7" x2="7" y2="17" stroke="white" stroke-width="2.5" stroke-linecap="round"/>'
    },
    {
      name: 'Snapchat',
      regex: /snapchat\.com/i,
      bg: '#FFFC00', labelColor: '#9A8F00',
      icon: '<path d="M12 5.5c-2 0-3.5 1.6-3.5 3.6v.7l-1 .2.4 1 1-.2c-.3.9-1 1.7-2.1 2 .3.5 2.2.6 2.2.6s.3 1.1 2 1.1 2-1.1 2-1.1 1.9-.1 2.2-.6c-1.1-.3-1.8-1.1-2.1-2l1 .2.4-1-1-.2v-.7c0-2-1.5-3.6-3.5-3.6z" fill="#333"/>'
    },
    {
      name: 'Dailymotion',
      regex: /dailymotion\.com/i,
      bg: '#0066DC', labelColor: '#0066DC',
      icon: '<text x="12" y="17.5" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="13" font-weight="bold">D</text>'
    },
    {
      name: 'Facebook',
      regex: /facebook\.com|fb\.watch/i,
      bg: '#1877F2', labelColor: '#1877F2',
      icon: '<path d="M13.5 7H12a1 1 0 0 0-1 1v2h2.5l-.4 2.5H11V19H8.5v-6.5H7V10h1.5V8A3.5 3.5 0 0 1 12 4.5H13.5V7z" fill="white"/>'
    },
    {
      name: 'Vimeo',
      regex: /vimeo\.com/i,
      bg: '#1AB7EA', labelColor: '#1AB7EA',
      icon: '<path d="M18 8.5c-.2 3-2 6.5-5 9-3.2 2.5-5.5 2-6.5.2-.6-1-1.2-3.5-1.8-6.7-.6-3.2-.2-4.5 1-4.5.7 0 1.8 1.5 3.3 4.5.5-2.5 1.5-3.8 3-3.8 2.3 0 3.5 2.8 3.5 2.8" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round"/>'
    }
  ];

  function detectPlatform(url) {
    if (!url) return null;
    return PLATFORMS.find(p => p.regex.test(url)) || null;
  }

  function updatePlatformBadge(url) {
    const badge = document.getElementById('platformBadge');
    const p = detectPlatform(url);
    if (!p) {
      badge.style.display = 'none';
      return;
    }
    const svg = `<svg width="18" height="18" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="${p.bg}"/>${p.icon}</svg>`;
    badge.innerHTML = svg + '<span>' + p.name + '</span>';
    badge.style.borderColor = p.labelColor;
    badge.style.color = p.labelColor;
    badge.style.display = 'inline-flex';
  }

  function setFormat(f) {
    format = f;
    document.getElementById('fmtVideo').classList.toggle('active', f === 'video');
    document.getElementById('fmtAudio').classList.toggle('active', f === 'audio');
    document.getElementById('qualityRow').style.display = f === 'audio' ? 'none' : 'block';
  }

  async function pasteURL() {
    try {
      const text = await navigator.clipboard.readText();
      document.getElementById('urlInput').value = text;
      updatePlatformBadge(text);
      document.getElementById('urlInput').focus();
    } catch {
      document.getElementById('urlInput').focus();
    }
  }

  async function startDownload() {
    const url = document.getElementById('urlInput').value.trim();
    const btn = document.getElementById('dlBtn');
    const bar = document.getElementById('progressBar');
    const fill = document.getElementById('progressFill');
    const label = document.getElementById('progressLabel');
    const status = document.getElementById('statusMsg');

    if (!url) {
      showStatus('error', '⚠ Colle une URL d\'abord');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'TÉLÉCHARGEMENT…';
    bar.classList.add('active');
    fill.style.width = '2%';
    label.textContent = 'Connexion…';
    status.className = 'status';
    status.style.display = 'none';

    try {
      const quality = document.getElementById('qualitySelect').value;
      const response = await fetch('/download-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, format, quality })
      });

      if (!response.ok) throw new Error('Erreur serveur ' + response.status);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();

        for (const part of parts) {
          const dataLine = part.split('\n').find(l => l.startsWith('data: '));
          if (!dataLine) continue;
          try {
            const evt = JSON.parse(dataLine.slice(6));

            if (evt.type === 'progress') {
              const pct = Math.min(evt.percent, 93);
              fill.style.width = pct + '%';
              label.textContent = pct.toFixed(1) + '%';

            } else if (evt.type === 'uploading') {
              fill.style.width = '97%';
              label.textContent = 'Envoi R2…';

            } else if (evt.type === 'done') {
              if (evt.success) {
                fill.style.width = '100%';
                label.textContent = '100%';
                await new Promise(r => setTimeout(r, 450));
                showStatus('success', '✓ ' + evt.filename);
                document.getElementById('urlInput').value = '';
                document.getElementById('platformBadge').style.display = 'none';
                loadHistory();
                if (evt.redirect_key) {
                  const a = document.createElement('a');
                  a.href = '/redirect/' + evt.redirect_key;
                  a.download = evt.filename || '';
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                }
              } else {
                showStatus('error', '✗ ' + (evt.error || 'Inconnue'));
              }
            }
          } catch (_) {}
        }
      }
    } catch (e) {
      showStatus('error', '✗ ' + (e.message || 'Serveur inaccessible'));
    } finally {
      btn.disabled = false;
      btn.textContent = 'TÉLÉCHARGER';
      setTimeout(() => {
        bar.classList.remove('active');
        fill.style.width = '0%';
        label.textContent = '0%';
      }, 700);
    }
  }

  function showStatus(type, msg) {
    const el = document.getElementById('statusMsg');
    el.className = 'status ' + type;
    el.textContent = msg;
  }

  async function loadHistory() {
    try {
      const res = await fetch('/history');
      const data = await res.json();
      const list = document.getElementById('historyList');

      if (!data.length) {
        list.innerHTML = '<li><div class="empty-history">Aucun téléchargement cette session</div></li>';
        return;
      }

      list.innerHTML = data.map(item => `
        <li>
          <span class="hist-dot"></span>
          <span class="hist-name">${item.filename}</span>
          <span class="hist-fmt">${item.format === 'audio' ? 'MP3' : 'MP4'}</span>
        </li>
      `).join('');
    } catch {}
  }

  document.getElementById('urlInput').addEventListener('input', e => {
    updatePlatformBadge(e.target.value);
  });

  document.getElementById('urlInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') startDownload();
  });
</script>
</body>
</html>"""
    return Response(html, mimetype='text/html')


# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"DAV DOWNLOADER — port {PORT} — ffmpeg: {FFMPEG_PATH} — r2: {_get_r2() is not None}")
    app.run(host="0.0.0.0", port=PORT, debug=False)
