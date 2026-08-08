"""Module de collecte — yt-dlp uniquement (pas de clé YouTube Data API).

Pour une chaîne : liste les vidéos du /videos tab, trie par view_count,
garde le top N (config/channels.json), télécharge transcript + miniature +
métadonnées (titre/description/vues/date) pour chacune. Idempotent : une
vidéo déjà collectée (meta.json présent) n'est pas re-téléchargée.
"""
import argparse
import json
import re
import shutil
import sys
from pathlib import Path

import yt_dlp
from PIL import Image

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from modules.common import (
    channel_video_dir,
    ensure_dirs,
    load_channel,
    load_channels,
    log_step,
    top_n,
    write_json,
)


def list_channel_videos(handle: str) -> list[dict]:
    url = f"https://www.youtube.com/@{handle}/videos"
    ydl_opts = {"extract_flat": True, "quiet": True, "skip_download": True}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
    entries = info.get("entries") or []
    videos = []
    for e in entries:
        if not e:
            continue
        vid = e.get("id")
        if not vid:
            continue
        videos.append(
            {
                "id": vid,
                "title": e.get("title") or "",
                "view_count": e.get("view_count") or 0,
                "duration": e.get("duration"),
            }
        )
    return videos


def pick_top(videos: list[dict], n: int) -> list[dict]:
    return sorted(videos, key=lambda v: v["view_count"], reverse=True)[:n]


def vtt_to_text(vtt_path: Path) -> str:
    raw = vtt_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    lines = []
    for line in raw:
        line = line.strip()
        if not line:
            continue
        if line.startswith(("WEBVTT", "Kind:", "Language:", "NOTE")):
            continue
        if "-->" in line:
            continue
        if re.match(r"^\d+$", line):
            continue
        clean = re.sub(r"<[^>]+>", "", line).strip()
        if clean:
            lines.append(clean)
    # les sous-titres auto YouTube répètent souvent la ligne précédente (scroll) :
    # dédoublonnage des lignes consécutives identiques
    dedup = []
    for l in lines:
        if not dedup or dedup[-1] != l:
            dedup.append(l)
    return " ".join(dedup)


def download_video_assets(video_id: str, out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    ydl_opts = {
        "skip_download": True,
        "writeinfojson": True,
        "writethumbnail": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": ["en", "en-US", "en-orig", "en.*"],
        "subtitlesformat": "vtt",
        "outtmpl": str(out_dir / "%(id)s.%(ext)s"),
        "quiet": True,
        "noplaylist": True,
        "ignoreerrors": True,
    }
    url = f"https://www.youtube.com/watch?v={video_id}"
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])

    info_candidates = list(out_dir.glob(f"{video_id}.info.json"))
    info = {}
    if info_candidates:
        info = json.loads(info_candidates[0].read_text(encoding="utf-8"))

    thumb_file = None
    for f in out_dir.glob(f"{video_id}.*"):
        if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
            thumb_file = f
            break
    if thumb_file:
        # yt-dlp livre souvent du WEBP même avec une extension .jpg forcée :
        # on ré-encode en vrai JPEG pour garantir un media_type fiable côté
        # API vision (Claude) et l'affichage dashboard.
        target = out_dir / "thumbnail.jpg"
        img = Image.open(thumb_file).convert("RGB")
        img.save(target, "JPEG", quality=90)
        if thumb_file != target:
            thumb_file.unlink()

    vtt_files = list(out_dir.glob(f"{video_id}.*.vtt"))
    transcript_text = vtt_to_text(vtt_files[0]) if vtt_files else ""
    (out_dir / "transcript.txt").write_text(transcript_text, encoding="utf-8")

    meta = {
        "id": video_id,
        "title": info.get("title", ""),
        "description": info.get("description", ""),
        "view_count": info.get("view_count") or 0,
        "upload_date": info.get("upload_date"),
        "duration": info.get("duration"),
        "url": url,
        "has_transcript": bool(transcript_text.strip()),
    }
    write_json(out_dir / "meta.json", meta)

    for f in out_dir.iterdir():
        if f.name not in ("meta.json", "transcript.txt", "thumbnail.jpg"):
            f.unlink()

    return meta


def collect_channel(slug: str, force: bool = False) -> dict:
    ensure_dirs()
    channel = load_channel(slug)
    n = top_n()
    log_step("COLLECT", f"{slug} — listage des vidéos ({channel['url']})")
    videos = list_channel_videos(channel["handle"])
    if not videos:
        log_step("COLLECT", f"{slug} — aucune vidéo trouvée")
        return {"slug": slug, "videos": [], "warning": "Aucune vidéo publique trouvée."}

    top = pick_top(videos, n)
    warning = None
    if len(videos) < n:
        warning = (
            f"Seulement {len(videos)} vidéo(s) publique(s) disponible(s) sur cette "
            f"chaîne (objectif {n})."
        )
        log_step("COLLECT", f"{slug} — {warning}")

    results = []
    for rank, v in enumerate(top, start=1):
        out_dir = channel_video_dir(slug, v["id"])
        meta_path = out_dir / "meta.json"
        if meta_path.exists() and not force:
            log_step("COLLECT", f"{slug} [{rank}/{len(top)}] {v['id']} — déjà collecté, skip")
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        else:
            log_step("COLLECT", f"{slug} [{rank}/{len(top)}] {v['id']} — téléchargement...")
            meta = download_video_assets(v["id"], out_dir)
        meta["rank"] = rank
        write_json(out_dir / "meta.json", meta)
        results.append(meta)

    return {"slug": slug, "videos": results, "warning": warning}


def collect_all(force: bool = False) -> list[dict]:
    return [collect_channel(ch["slug"], force=force) for ch in load_channels()]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Collecte yt-dlp par chaîne")
    parser.add_argument("--channel", help="slug d'une chaîne (config/channels.json)")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--force", action="store_true", help="Re-télécharge même si déjà présent")
    args = parser.parse_args()

    if args.all:
        out = collect_all(force=args.force)
    elif args.channel:
        out = [collect_channel(args.channel, force=args.force)]
    else:
        parser.error("--channel <slug> ou --all requis")

    print(json.dumps(out, ensure_ascii=False, indent=2))
