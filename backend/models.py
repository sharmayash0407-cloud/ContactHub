"""Contact model and parameterized database operations."""

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from .database import get_db


@dataclass
class Contact:
    id: int
    name: str
    phone: str
    email: str
    company: str
    notes: str
    favorite: bool
    created_at: str
    updated_at: str

    @classmethod
    def from_row(cls, row):
        values = dict(row)
        values["favorite"] = bool(values["favorite"])
        return cls(**values)

    def to_dict(self):
        return asdict(self)


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def list_contacts():
    rows = get_db().execute("SELECT * FROM contacts ORDER BY id").fetchall()
    return [Contact.from_row(row) for row in rows]


def find_contact(contact_id):
    if contact_id > 9223372036854775807:
        return None  # SQLite IDs are signed 64-bit integers.
    row = get_db().execute("SELECT * FROM contacts WHERE id = ?", (contact_id,)).fetchone()
    return Contact.from_row(row) if row is not None else None


def create_contact(data):
    db = get_db()
    now = timestamp()
    # Bind values with question marks: user input never becomes SQL code.
    with db:
        cursor = db.execute(
            """INSERT INTO contacts
               (name, phone, email, company, notes, favorite, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (data["name"], data["phone"], data["email"], data["company"],
             data["notes"], data["favorite"], now, now),
        )
    return find_contact(cursor.lastrowid)


def update_contact(contact_id, data):
    db = get_db()
    with db:
        cursor = db.execute(
            """UPDATE contacts SET name = ?, phone = ?, email = ?, company = ?,
               notes = ?, favorite = ?, updated_at = ? WHERE id = ?""",
            (data["name"], data["phone"], data["email"], data["company"],
             data["notes"], data["favorite"], timestamp(), contact_id),
        )
    return find_contact(contact_id) if cursor.rowcount else None


def delete_contact(contact_id):
    if contact_id > 9223372036854775807:
        return False
    db = get_db()
    with db:
        cursor = db.execute("DELETE FROM contacts WHERE id = ?", (contact_id,))
    return cursor.rowcount > 0
