"""Helpers partagés : chemins, env, logging, chargement config chaînes."""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
CHANNELS_DIR = DATA_DIR / "channels"
ANALYSIS_DIR = DATA_DIR / "analysis"
GENERATED_DIR = DATA_DIR / "generated"
CONFIG_DIR = ROOT / "config"

sys.path.insert(0, str(ROOT))


def log_step(tag: str, message: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] [{tag}] {message}", flush=True)


def get_env(key: str, required: bool = False, default: str = "") -> str:
    from backend.env_manager import read_env

    val = read_env().get(key) or ""
    if required and not val:
        raise RuntimeError(
            f"{key} manquante dans .env — impossible de continuer (aucune clé "
            f"trouvée en config machine existante non plus)."
        )
    return val or default


def load_channels() -> list[dict]:
    with open(CONFIG_DIR / "channels.json", encoding="utf-8") as f:
        cfg = json.load(f)
    return cfg["channels"]


def load_channel(slug: str) -> dict:
    for ch in load_channels():
        if ch["slug"] == slug:
            return ch
    raise ValueError(f"Chaîne inconnue: {slug}")


def top_n() -> int:
    with open(CONFIG_DIR / "channels.json", encoding="utf-8") as f:
        cfg = json.load(f)
    return cfg.get("top_n_per_channel", 4)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_dirs() -> None:
    for d in (CHANNELS_DIR, ANALYSIS_DIR, GENERATED_DIR):
        d.mkdir(parents=True, exist_ok=True)


def channel_video_dir(slug: str, video_id: str) -> Path:
    return CHANNELS_DIR / slug / "videos" / video_id


def channel_analysis_dir(slug: str) -> Path:
    return ANALYSIS_DIR / slug


def read_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def slugify(text: str) -> str:
    import re
    import unicodedata

    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return text[:60] or "sujet"
