"""Development-only synthetic data. Preview by default; --apply backs up and imports."""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import random
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.app import validate_contact
from backend.models import timestamp

MARKER = '[contacthub-seed-v1:'


def generate_contacts():
    """500 unique fictional identities, reproducible with seed 20261030."""
    rng = random.Random(20261030)
    first = 'Aarav Aditi Arjun Ananya Dev Diya Ishaan Kavya Kiran Meera Neel Priya Rohan Saanvi Tara Vihaan Alex Amelia Benjamin Chloe Daniel Elena Felix Grace Hugo Iris James Layla Luca Maya Noah Olivia Oscar Sofia Theo Zara'.split()
    last = 'Sharma Patel Iyer Rao Kapoor Mehta Nair Joshi Sen Das Morgan Rivera Chen Kim Silva Martin Laurent Wilson Bennett Brooks'.split()
    pairs = rng.sample([(a, b) for a in first for b in last], 500)
    favorites = set(rng.sample(range(500), 90))
    companies = ['Aurora Kite Labs', 'Indigo Orchard Studio', 'Copper Comet Works', 'Maple Lantern Analytics', 'Saffron Cloud Collective', 'Silver Otter Design', 'Coral Summit Learning', 'Cobalt Meadow Systems']
    rows = []
    for i, (a, b) in enumerate(pairs):
        rows.append(validate_contact(dict(
            name=f'{a} {b}',
            phone='' if i % 11 == 0 else f'+1-202-555-{100 + i % 100:04d}',
            email='' if i % 13 == 0 else f'{a.lower()}.{b.lower()}.demo{i+1:03d}@{rng.choice(["example.com", "example.org", "example.net"])}',
            company='' if i % 17 == 0 else rng.choice(companies),
            notes=f'{MARKER}{i+1:03d}] Entirely fictional demonstration identity; company and contact details are synthetic.',
            favorite=i in favorites)))
    assert len(rows) == len({r['name'] for r in rows}) == 500
    return rows


def seed(database, apply=False):
    """Never create an absent database; preserve existing rows byte-for-value."""
    database = Path(database).resolve(strict=True)
    records = generate_contacts()
    with sqlite3.connect(database.as_uri() + '?mode=rw', uri=True) as db:
        db.execute('BEGIN IMMEDIATE' if apply else 'BEGIN')
        try:
            before = db.execute('SELECT * FROM contacts ORDER BY id').fetchall()
            existing = db.execute('SELECT count(*) FROM contacts WHERE instr(notes, ?) > 0', (MARKER,)).fetchone()[0]
            if existing:
                raise ValueError(f'Seed marker already present in {existing} records; refusing duplicate or partial import.')
            print(f'Existing: {len(before)}; proposed additions: {len(records)}; favorites: 90')
            if not apply:
                db.rollback()
                return None
            backup_dir = database.parent / 'backups'
            backup_dir.mkdir(exist_ok=True)
            backup = backup_dir / f'{database.stem}-before-seed-{datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")}.db'
            # A separate read connection backs up the pre-import database consistently.
            with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as source:
                with sqlite3.connect(backup) as target:
                    source.backup(target)
                    assert target.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
                    assert target.execute('SELECT * FROM contacts ORDER BY id').fetchall() == before
            now = timestamp()
            db.executemany('INSERT INTO contacts (name,phone,email,company,notes,favorite,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
                [(r['name'],r['phone'],r['email'],r['company'],r['notes'],r['favorite'],now,now) for r in records])
            after = db.execute('SELECT * FROM contacts ORDER BY id').fetchall()
            assert len(after) == len(before) + 500
            assert after[:len(before)] == before
            assert db.execute('SELECT count(*) FROM contacts WHERE instr(notes, ?) > 0', (MARKER,)).fetchone()[0] == 500
            db.commit()
            print(f'Added: 500; total: {len(after)}; verified backup: {backup}')
            return backup
        except BaseException:
            db.rollback()
            raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Back up and write 500 records; otherwise preview only')
    parser.add_argument('--database', type=Path, default=ROOT / 'backend/contacts.db', help='Existing local database path')
    args = parser.parse_args()
    try:
        seed(args.database, args.apply)
    except (ValueError, OSError, sqlite3.Error) as exc:
        parser.exit(1, f'Import refused: {exc}\n')
