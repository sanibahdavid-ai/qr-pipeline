"""Historique des sujets générés + vérification anti-doublon.

Normalisation simple (minuscule, sans accents/ponctuation) + comparaison
floue (SequenceMatcher) pour attraper les reformulations proches d'un sujet
déjà traité, pas seulement les doublons exacts.
"""
import difflib
import re
import unicodedata
from pathlib import Path

from modules.common import GENERATED_DIR, now_iso, read_json, write_json

HISTORY_PATH = GENERATED_DIR / "history.json"
FUZZY_THRESHOLD = 0.85


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def load_history() -> dict:
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    if not HISTORY_PATH.exists():
        return {}
    return read_json(HISTORY_PATH)


def save_history(history: dict) -> None:
    write_json(HISTORY_PATH, history)


def is_duplicate(subject: str) -> dict | None:
    """Retourne l'entrée d'historique en conflit, ou None si le sujet est libre."""
    norm = normalize(subject)
    history = load_history()
    if norm in history:
        return history[norm]
    for existing_norm, entry in history.items():
        ratio = difflib.SequenceMatcher(None, norm, existing_norm).ratio()
        if ratio >= FUZZY_THRESHOLD:
            return entry
    return None


def mark_done(subject: str, title: str, folder: str) -> None:
    history = load_history()
    norm = normalize(subject)
    history[norm] = {
        "subject": subject,
        "title": title,
        "folder": folder,
        "date": now_iso(),
        "status": "done",
    }
    save_history(history)


def list_history() -> list[dict]:
    history = load_history()
    return sorted(history.values(), key=lambda e: e.get("date", ""), reverse=True)
