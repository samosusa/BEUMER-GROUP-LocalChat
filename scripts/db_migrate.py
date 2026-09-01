"""Run LocalChat SQLite migrations on Windows or Linux."""

from __future__ import annotations

import argparse
import re
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = ROOT / "migrations"
DATABASE_PATH = ROOT / "data" / "app.db"
MIGRATION_PATTERN = re.compile(r"^(\d+)_.*\.sql$")


def migration_files() -> list[Path]:
    return sorted(
        (path for path in MIGRATIONS_DIR.glob("*.sql") if MIGRATION_PATTERN.match(path.name)),
        key=lambda path: int(MIGRATION_PATTERN.match(path.name).group(1)),
    )


def migration_sql(path: Path, direction: str) -> str:
    sections = path.read_text(encoding="utf-8").split("-- migrate:")
    for section in sections:
        if section.startswith(direction):
            return section[len(direction):].strip()
    raise ValueError(f"Migration {path.name} has no {direction} section")


def connect() -> sqlite3.Connection:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute(
        "CREATE TABLE IF NOT EXISTS _migrations "
        "(name TEXT PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    )
    return connection


def applied_migrations(connection: sqlite3.Connection) -> set[str]:
    return {row[0] for row in connection.execute("SELECT name FROM _migrations")}


def up(connection: sqlite3.Connection) -> None:
    applied = applied_migrations(connection)
    for path in migration_files():
        if path.name in applied:
            continue
        with connection:
            connection.executescript(migration_sql(path, "up"))
            connection.execute("INSERT INTO _migrations (name) VALUES (?)", (path.name,))
        print(f"applied {path.name}")


def down(connection: sqlite3.Connection) -> None:
    applied = applied_migrations(connection)
    for path in reversed(migration_files()):
        if path.name not in applied:
            continue
        with connection:
            connection.executescript(migration_sql(path, "down"))
            connection.execute("DELETE FROM _migrations WHERE name = ?", (path.name,))
        print(f"reverted {path.name}")


def status(connection: sqlite3.Connection) -> None:
    applied = applied_migrations(connection)
    for path in migration_files():
        state = "applied" if path.name in applied else "pending"
        print(f"{state} {path.name}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("up", "down", "status"))
    args = parser.parse_args()
    with connect() as connection:
        {"up": up, "down": down, "status": status}[args.command](connection)


if __name__ == "__main__":
    main()