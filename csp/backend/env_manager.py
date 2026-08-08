"""Lecture/écriture du .env local (clone-script-pipeline\\.env) — jamais partagé
avec un autre projet à l'exécution. Auto-copie la clé Claude depuis une config
machine existante au premier démarrage, sans jamais la demander à l'utilisateur.

En local, les valeurs vivent dans le fichier .env. En déploiement cloud (Render),
il n'y a pas de fichier .env — les valeurs arrivent en variables d'environnement
du process. read_env() fusionne les deux : fichier .env prioritaire, sinon
os.environ, pour que le même code tourne dans les deux contextes sans changement."""
import os
import secrets
import string
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"

KNOWN_KEYS = ["ANTHROPIC_API_KEY", "DASHBOARD_PORT", "DASHBOARD_PASSWORD", "SESSION_SECRET"]

# Sources canoniques déjà utilisées par les autres pipelines de la machine
# (ordre de préférence). On ne lit que ANTHROPIC_API_KEY, jamais rien d'autre.
# Uniquement valable en local — absentes sur un serveur cloud (pas de problème,
# la boucle de secours ci-dessous les ignore silencieusement si absentes).
FOREIGN_SOURCES = [
    Path(r"C:\projets\qr-pipeline\.env.local"),
    Path(r"C:\projets\health-pipeline\pipeline\.env"),
]


def read_env() -> dict:
    values = dict(os.environ)  # base : variables d'env du process (Render en prod)
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            values[k.strip()] = v.strip()  # le fichier .env local est prioritaire
    return values


def write_env_value(key: str, value: str) -> None:
    os.environ[key] = value
    if not ENV_PATH.parent.exists():
        return
    values = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            values[k.strip()] = v.strip()
    values[key] = value
    lines = [
        "# Clone Script Pipeline — clé dédiée à ce projet (NE JAMAIS réutiliser une",
        "# clé d'un autre projet à l'exécution). Géré automatiquement au démarrage.",
        "# En production (Render), ces valeurs sont injectées en variables d'env —",
        "# ce fichier ne sert qu'en local.",
        "",
    ]
    for k in KNOWN_KEYS:
        lines.append(f"{k}={values.get(k, '')}")
    for k, v in values.items():
        if k not in KNOWN_KEYS:
            lines.append(f"{k}={v}")
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def mask_key(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return value[:4] + "*" * (len(value) - 8) + value[-4:]


def _read_foreign_env(path: Path) -> dict:
    values = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        values[k.strip()] = v.strip()
    return values


def _random_password(length: int = 16) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def bootstrap_auto_keys() -> dict:
    """Appelé au démarrage du backend. Complète ANTHROPIC_API_KEY si absente
    (copie locale uniquement), génère DASHBOARD_PASSWORD/SESSION_SECRET si absents
    (marche aussi bien en local qu'en cloud — ne dépend d'aucune source externe),
    sans jamais rien demander à l'utilisateur ni exposer les valeurs dans les logs.
    Retourne un résumé (clé -> source) pour les logs."""
    current = read_env()
    result = {}

    if not current.get("ANTHROPIC_API_KEY"):
        for source in FOREIGN_SOURCES:
            val = _read_foreign_env(source).get("ANTHROPIC_API_KEY", "")
            if val:
                write_env_value("ANTHROPIC_API_KEY", val)
                result["ANTHROPIC_API_KEY"] = str(source)
                break

    if not read_env().get("DASHBOARD_PORT"):
        write_env_value("DASHBOARD_PORT", "4610")

    if not read_env().get("SESSION_SECRET"):
        write_env_value("SESSION_SECRET", secrets.token_hex(32))

    if not read_env().get("DASHBOARD_PASSWORD"):
        # Fixe (pas aléatoire) : sur un déploiement cloud sans accès aux logs de
        # build, un mot de passe généré au hasard serait illisible pour tout le
        # monde. Changeable plus tard via la variable d'env DASHBOARD_PASSWORD.
        write_env_value("DASHBOARD_PASSWORD", "csp-dav-2026")
        result["DASHBOARD_PASSWORD_GENERATED"] = "csp-dav-2026"

    return result
