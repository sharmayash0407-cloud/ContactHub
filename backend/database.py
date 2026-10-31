"""SQLite connections and schema, using Python's standard library."""

import sqlite3
from flask import current_app, g


def get_db():
    """Reuse one connection per request."""
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
    return g.db


def close_db(error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create the table without deleting existing contacts."""
    db = get_db()
    db.execute("""
        CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL CHECK(length(trim(name)) > 0),
            phone TEXT NOT NULL DEFAULT '',
            email TEXT NOT NULL DEFAULT '',
            company TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    # Existing installations gain nullable columns without rewriting any records.
    # Fixed names only: PRAGMA checks make this safe to repeat on every startup.
    columns = {row[1] for row in db.execute("PRAGMA table_info(contacts)")}
    with db:
        for column in ("city", "locality"):
            if column not in columns:
                db.execute(f"ALTER TABLE contacts ADD COLUMN {column} TEXT")
