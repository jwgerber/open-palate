"""Environment-driven configuration."""
import logging
import os
import secrets
from collections.abc import Mapping
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_DATABASE_URL = "sqlite:////data/tasting.db"
# Paper-sheet scan models, first one used. Not an env var: change it here.
DEFAULT_SCAN_MODELS = ("claude-sonnet-5-5", "claude-opus-5-5")


def normalize_database_url(url: str) -> str:
    """Hosts hand out plain ``postgresql://`` (or ``postgres://``) URLs; point
    them at the psycopg 3 driver, the one we ship."""
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def _sqlite_file(database_uri: str) -> Path | None:
    """The database file of a ``sqlite:///<path>`` URI, or None for any other kind
    (including in-memory SQLite, which has no folder)."""
    prefix = "sqlite:///"
    if not database_uri.startswith(prefix):
        return None
    path = database_uri[len(prefix):].split("?", 1)[0]
    if path in ("", ":memory:"):
        return None
    return Path(path)


def _read_key(path: Path) -> str:
    key = path.read_text().strip()
    if not key:
        raise RuntimeError(f"{path} is empty. Set SECRET_KEY, or delete that empty file.")
    return key


def _create_key_file(path: Path) -> str:
    """Write a fresh key to a temp file, then hard-link it into place: the key file
    never exists half-written, and exactly one concurrent worker's key wins."""
    key = secrets.token_urlsafe(48)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{secrets.token_hex(4)}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write(key)
        try:
            os.link(tmp, path)
        except FileExistsError:
            # Another worker won the race: use theirs.
            return _read_key(path)
        return key
    finally:
        tmp.unlink(missing_ok=True)


def resolve_secret_key(env: Mapping, database_uri: str) -> str:
    """SECRET_KEY from the environment, else a key generated once and kept in
    ``secret_key`` beside the SQLite file. In-memory SQLite gets a per-process key;
    Postgres has no data folder, so it must set one."""
    if env.get("SECRET_KEY"):
        return env["SECRET_KEY"]
    if database_uri.startswith("sqlite:///") and _sqlite_file(database_uri) is None:
        return secrets.token_urlsafe(48)
    db_file = _sqlite_file(database_uri)
    if db_file is None:
        raise RuntimeError("Set SECRET_KEY: with Postgres there is no data folder to keep a generated key in.")
    path = db_file.parent / "secret_key"
    try:
        if path.exists():
            return _read_key(path)
        return _create_key_file(path)
    except OSError as exc:
        raise RuntimeError(
            f"Can't read or write {path}. Set SECRET_KEY, or make that folder writable."
        ) from exc


def _flag(value: str | None) -> bool:
    return (value or "").strip().lower() in ("1", "true", "yes")


def _tri_state(value: str | None) -> bool | None:
    """True / False when set to a recognised word, None when unset or blank."""
    if not (value or "").strip():
        return None
    return _flag(value)


def load_config(env=os.environ) -> dict:
    """Read settings from the environment; fail early only where there is no safe default."""
    database_uri = normalize_database_url(env.get("DATABASE_URL") or DEFAULT_DATABASE_URL)
    base_url = env.get("BASE_URL")
    if not base_url:
        logger.warning("BASE_URL is not set; using http://localhost:8000. Set it to the address people open.")
        base_url = "http://localhost:8000"
    settings = {
        "SECRET_KEY": resolve_secret_key(env, database_uri),
        "BASE_URL": base_url.rstrip("/"),
        "SQLALCHEMY_DATABASE_URI": database_uri,
        "PROXY_HOPS": int(env.get("PROXY_HOPS", "1")),
        "ALLOW_SIGNUP": _flag(env.get("ALLOW_SIGNUP", "false")),
        "SETUP_OPEN": _tri_state(env.get("SETUP_OPEN")),
        "SETUP_PASSWORD": env.get("SETUP_PASSWORD") or None,
        "IN_CONTAINER": _flag(env.get("OPEN_PALATE_CONTAINER")),
        "SMTP_HOST": env.get("SMTP_HOST") or None,
        "SMTP_PORT": int(env.get("SMTP_PORT") or 587),
        "SMTP_USER": env.get("SMTP_USER") or None,
        "SMTP_PASSWORD": env.get("SMTP_PASSWORD") or None,
        "SMTP_FROM": env.get("SMTP_FROM") or None,
        # Optional: the paper-sheet scan is off (404 scan_disabled) without it.
        "ANTHROPIC_API_KEY": env.get("ANTHROPIC_API_KEY") or None,
        "SCAN_MODELS": DEFAULT_SCAN_MODELS,
    }
    # Set by migrations/env.py: the migration process builds the app on a database
    # that may not be migrated yet, and must not log (or fail on) the setup link.
    if env.get("LOG_SETUP_LINK") is not None:
        settings["LOG_SETUP_LINK"] = _flag(env["LOG_SETUP_LINK"])
    return settings
