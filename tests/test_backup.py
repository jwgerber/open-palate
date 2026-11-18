import sqlite3
from datetime import date, timedelta

from app import create_app


def make_sqlite_app(tmp_path):
    db_file = tmp_path / "live.db"
    conn = sqlite3.connect(db_file)
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
    conn.commit()
    conn.close()
    app = create_app({"TESTING": True, "SECRET_KEY": "x", "BASE_URL": "http://localhost",
                      "SQLALCHEMY_DATABASE_URI": f"sqlite:///{db_file}"})
    return app, db_file


def test_backup_consistent_while_writing(tmp_path):
    app, db_file = make_sqlite_app(tmp_path)
    writer = sqlite3.connect(db_file, isolation_level=None)
    writer.execute("INSERT INTO t (v) VALUES ('committed')")
    writer.execute("BEGIN")
    writer.execute("INSERT INTO t (v) VALUES ('in-flight')")
    out = tmp_path / "backups"
    result = app.test_cli_runner().invoke(args=["backup", str(out)])
    assert result.exit_code == 0, result.output
    copy = out / f"tasting-{date.today().isoformat()}.db"
    assert str(copy) in result.output
    rows = sqlite3.connect(copy).execute("SELECT v FROM t").fetchall()
    assert rows == [("committed",)]
    writer.execute("COMMIT")


def test_backup_overwrites_same_day(tmp_path):
    app, _ = make_sqlite_app(tmp_path)
    out = tmp_path / "b"
    for _ in range(2):
        assert app.test_cli_runner().invoke(args=["backup", str(out)]).exit_code == 0
    assert len(list(out.glob("tasting-*.db"))) == 1


def test_backup_keeps_14(tmp_path):
    app, _ = make_sqlite_app(tmp_path)
    out = tmp_path / "b"
    out.mkdir()
    today = date.today()
    for days_ago in range(1, 20):
        (out / f"tasting-{(today - timedelta(days=days_ago)).isoformat()}.db").write_bytes(b"old")
    (out / "notes.txt").write_text("keep me")
    assert app.test_cli_runner().invoke(args=["backup", str(out)]).exit_code == 0
    names = sorted(p.name for p in out.glob("tasting-*.db"))
    assert len(names) == 14
    assert f"tasting-{today.isoformat()}.db" in names
    assert f"tasting-{(today - timedelta(days=13)).isoformat()}.db" in names
    assert f"tasting-{(today - timedelta(days=14)).isoformat()}.db" not in names
    assert (out / "notes.txt").exists()


def test_backup_postgres_refuses(tmp_path):
    app = create_app({"TESTING": True, "SECRET_KEY": "x", "BASE_URL": "http://localhost",
                      "SQLALCHEMY_DATABASE_URI": "postgresql://u:p@localhost:1/none"})
    result = app.test_cli_runner().invoke(args=["backup", str(tmp_path)])
    assert result.exit_code == 2
    assert "use your database host's backups" in result.output
