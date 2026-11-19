import logging
import os

import pytest

from config import load_config


def sqlite_env(tmp_path, **extra):
    return {"DATABASE_URL": f"sqlite:///{tmp_path}/t.db", "BASE_URL": "http://localhost", **extra}


def test_env_secret_key_wins(tmp_path):
    config = load_config(sqlite_env(tmp_path, SECRET_KEY="x"))
    assert config["SECRET_KEY"] == "x"
    assert not (tmp_path / "secret_key").exists()


def test_sqlite_key_created_beside_db(tmp_path):
    key = load_config(sqlite_env(tmp_path))["SECRET_KEY"]
    path = tmp_path / "secret_key"
    assert len(key) >= 64
    assert path.read_text().strip() == key
    assert path.stat().st_mode & 0o777 == 0o600


def test_key_is_stable_across_loads(tmp_path):
    env = sqlite_env(tmp_path)
    assert load_config(env)["SECRET_KEY"] == load_config(env)["SECRET_KEY"]


def test_existing_key_file_wins_over_a_second_create(tmp_path):
    existing = "abc" * 20
    (tmp_path / "secret_key").write_text(existing)
    assert load_config(sqlite_env(tmp_path))["SECRET_KEY"] == existing


@pytest.mark.skipif(hasattr(os, "geteuid") and os.geteuid() == 0, reason="root ignores permissions")
def test_unwritable_folder_fails_with_path(tmp_path):
    folder = tmp_path / "ro"
    folder.mkdir()
    folder.chmod(0o500)
    try:
        env = {"DATABASE_URL": f"sqlite:///{folder}/t.db", "BASE_URL": "http://localhost"}
        with pytest.raises(RuntimeError) as exc:
            load_config(env)
    finally:
        folder.chmod(0o700)
    assert str(folder) in str(exc.value)
    assert "SECRET_KEY" in str(exc.value)


def test_postgres_without_secret_key_fails():
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        load_config({"DATABASE_URL": "postgresql://u@h/db", "BASE_URL": "http://localhost"})


def test_base_url_defaults_to_localhost(tmp_path, caplog):
    env = sqlite_env(tmp_path)
    del env["BASE_URL"]
    with caplog.at_level(logging.WARNING):
        config = load_config(env)
    assert config["BASE_URL"] == "http://localhost:8000"
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING and "BASE_URL" in r.getMessage()]
    assert len(warnings) == 1


def test_setup_switches(tmp_path):
    base = sqlite_env(tmp_path)
    config = load_config(base)
    assert config["SETUP_OPEN"] is None
    assert config["SETUP_PASSWORD"] is None
    assert config["IN_CONTAINER"] is False
    config = load_config({**base, "SETUP_OPEN": "true", "SETUP_PASSWORD": "", "OPEN_PALATE_CONTAINER": "1"})
    assert config["SETUP_OPEN"] is True
    assert config["SETUP_PASSWORD"] is None
    assert config["IN_CONTAINER"] is True
    for value in ("false", "0", "no"):
        assert load_config({**base, "SETUP_OPEN": value})["SETUP_OPEN"] is False
    assert load_config({**base, "SETUP_OPEN": ""})["SETUP_OPEN"] is None


def test_secret_never_logged(tmp_path, caplog):
    with caplog.at_level(logging.DEBUG):
        key = load_config(sqlite_env(tmp_path))["SECRET_KEY"]
    assert key not in caplog.text


def test_empty_key_file_is_refused(tmp_path):
    (tmp_path / "secret_key").write_text("  \n")
    with pytest.raises(RuntimeError) as exc:
        load_config(sqlite_env(tmp_path))
    assert str(tmp_path / "secret_key") in str(exc.value)


def test_key_file_is_never_seen_empty(tmp_path, monkeypatch):
    """The winner's file appears already complete; a loser that hits
    FileExistsError on link returns the winner's content."""
    path = tmp_path / "secret_key"
    winner = "w" * 64
    real_link = os.link

    def racing_link(src, dst, *args, **kwargs):
        assert open(src).read(), "temp file must be fully written before linking"
        path.write_text(winner)  # another worker got there first
        return real_link(src, dst, *args, **kwargs)  # raises FileExistsError

    monkeypatch.setattr(os, "link", racing_link)
    assert load_config(sqlite_env(tmp_path))["SECRET_KEY"] == winner
    assert [p.name for p in tmp_path.iterdir()] == ["secret_key"]


def test_memory_db_writes_no_file(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    key = load_config({"DATABASE_URL": "sqlite:///:memory:", "BASE_URL": "http://localhost"})["SECRET_KEY"]
    assert len(key) >= 64
    assert list(tmp_path.iterdir()) == []


def test_query_string_is_not_part_of_the_folder(tmp_path):
    env = {"DATABASE_URL": f"sqlite:///{tmp_path}/t.db?timeout=5", "BASE_URL": "http://localhost"}
    key = load_config(env)["SECRET_KEY"]
    assert (tmp_path / "secret_key").read_text() == key


def test_relative_sqlite_path_and_key_sit_together_under_instance(tmp_path, monkeypatch):
    import config
    monkeypatch.setattr(config, "INSTANCE_DIR", tmp_path / "instance")
    monkeypatch.chdir(tmp_path)
    loaded = load_config({"DATABASE_URL": "sqlite:///dev.db?timeout=5", "BASE_URL": "http://localhost"})
    assert loaded["SQLALCHEMY_DATABASE_URI"] == f"sqlite:///{tmp_path}/instance/dev.db?timeout=5"
    assert (tmp_path / "instance" / "secret_key").read_text().strip() == loaded["SECRET_KEY"]
    assert not (tmp_path / "secret_key").exists()


def test_in_memory_sqlite_gets_a_per_process_key(tmp_path):
    for uri in ("sqlite://", "sqlite:///:memory:"):
        first = load_config({"DATABASE_URL": uri, "BASE_URL": "http://localhost"})
        second = load_config({"DATABASE_URL": uri, "BASE_URL": "http://localhost"})
        assert len(first["SECRET_KEY"]) >= 64
        assert first["SECRET_KEY"] != second["SECRET_KEY"]


def test_relative_sqlite_with_secret_key_creates_the_folder(tmp_path, monkeypatch):
    import config
    from sqlalchemy import create_engine, text
    monkeypatch.setattr(config, "INSTANCE_DIR", tmp_path / "instance")
    loaded = load_config({"DATABASE_URL": "sqlite:///dev.db", "SECRET_KEY": "dev",
                          "BASE_URL": "http://localhost"})
    assert (tmp_path / "instance").is_dir()
    with create_engine(loaded["SQLALCHEMY_DATABASE_URI"]).connect() as conn:
        assert conn.execute(text("select 1")).scalar() == 1
