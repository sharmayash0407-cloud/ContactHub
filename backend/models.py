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
    city: str = ""
    locality: str = ""

    @classmethod
    def from_row(cls, row):
        values = dict(row)
        values["favorite"] = bool(values["favorite"])
        for field in ("city", "locality"):
            values[field] = values.get(field) or ""
        return cls(**values)

    def to_dict(self):
        return asdict(self)


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


SEARCH_FIELDS = {"all": ("name", "phone", "email", "company", "city", "locality"),
                 **{column: (column,) for column in ("name", "phone", "email", "company", "city", "locality")}}
SORT_ORDERS = {
    "name_asc": "name COLLATE NOCASE ASC, id ASC",
    "name_desc": "name COLLATE NOCASE DESC, id ASC",
    # Missing companies follow named companies, then sort by name and ID.
    "company_asc": "(trim(COALESCE(company, '')) = '') ASC, COALESCE(company, '') COLLATE NOCASE ASC, name COLLATE NOCASE ASC, id ASC",
    "newest": "created_at DESC, id DESC",
    "oldest": "created_at ASC, id ASC",
}


def list_contacts(search="", favorites_only=False, page=None, page_size=25, field="all", sort=None):
    columns = SEARCH_FIELDS[field]
    order = " ORDER BY " + SORT_ORDERS[sort or "name_asc"]
    search = search.strip()
    conditions = []
    parameters = []
    if search:
        # Bind SQL values and escape LIKE wildcards for literal partial matches.
        literal = search.replace("!", "!!").replace("%", "!%").replace("_", "!_")
        pattern = f"%{literal}%"
        conditions.append("(" + " OR ".join(f"{column} LIKE ? ESCAPE '!'" for column in columns) + ")")
        parameters.extend([pattern] * len(columns))
    if favorites_only:
        conditions.append("favorite = ?")
        parameters.append(1)
    # Only fixed SQL fragments are combined; user values stay in parameters.
    where = " WHERE " + " AND ".join(conditions) if conditions else ""
    db = get_db()
    if page is not None:
        # One read snapshot keeps count and rows consistent during concurrent writes.
        with db:
            db.execute("BEGIN")
            total = db.execute("SELECT COUNT(*) FROM contacts" + where, parameters).fetchone()[0]
            total_pages = (total + page_size - 1) // page_size
            page = min(page, max(1, total_pages))
            rows = db.execute("SELECT * FROM contacts" + where +
                order + " LIMIT ? OFFSET ?",
                [*parameters, page_size, (page - 1) * page_size]).fetchall()
        return [Contact.from_row(row) for row in rows], dict(
            page=page, page_size=page_size, total=total, total_pages=total_pages)
    if sort is None and not conditions:
        order = " ORDER BY id"  # Preserve legacy unpaginated callers without a sort parameter.
    rows = db.execute("SELECT * FROM contacts" + where + order, parameters).fetchall()
    return [Contact.from_row(row) for row in rows]



def set_favorite(contact_id, favorite):
    if contact_id > 9223372036854775807:
        return None
    db = get_db()
    with db:
        cursor = db.execute(
            "UPDATE contacts SET favorite = ?, updated_at = ? WHERE id = ?",
            (favorite, timestamp(), contact_id),
        )
    return find_contact(contact_id) if cursor.rowcount else None


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
               (name, phone, email, company, notes, favorite, created_at, updated_at, city, locality)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (data["name"], data["phone"], data["email"], data["company"],
             data["notes"], data["favorite"], now, now, data.get("city", ""), data.get("locality", "")),
        )
    return find_contact(cursor.lastrowid)


def update_contact(contact_id, data):
    db = get_db()
    with db:
        cursor = db.execute(
            """UPDATE contacts SET name = ?, phone = ?, email = ?, company = ?,
               notes = ?, favorite = ?, updated_at = ?,
               city = COALESCE(?, city), locality = COALESCE(?, locality) WHERE id = ?""",
            (data["name"], data["phone"], data["email"], data["company"],
             data["notes"], data["favorite"], timestamp(), data.get("city"), data.get("locality"), contact_id),
        )
    return find_contact(contact_id) if cursor.rowcount else None


def delete_contact(contact_id):
    if contact_id > 9223372036854775807:
        return False
    db = get_db()
    with db:
        cursor = db.execute("DELETE FROM contacts WHERE id = ?", (contact_id,))
    return cursor.rowcount > 0
