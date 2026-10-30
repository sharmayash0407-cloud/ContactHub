import sqlite3,tempfile
from pathlib import Path
from scripts.seed_contacts import seed,generate_contacts
from backend.app import create_app

def test_seed_safety(tmp_path):
 db=tmp_path/'test.db'
 app=create_app({'DATABASE':str(db),'TESTING':True})
 with app.test_client() as client:
  old=client.post('/api/contacts',json={'name':'Existing Fixture'}).json['contact']
 before=db.read_bytes()
 seed(db)
 assert db.read_bytes()==before
 backup=seed(db,True)
 with app.test_client() as client:
  assert client.get('/api/contacts').json['contacts'].__len__()==501
  assert client.get(f'/api/contacts/{old["id"]}').json['contact']==old
  assert len(client.get('/api/contacts?favorite=true').json['contacts'])==90
 try: seed(db,True)
 except ValueError: pass
 else: raise AssertionError('repeat not refused')
 with sqlite3.connect(backup) as c: assert c.execute('select count(*) from contacts').fetchone()[0]==1

def test_generation():
 records=generate_contacts()
 assert records==generate_contacts()
 assert len({r['notes'] for r in records})==500
 assert len({r['name'] for r in records})==500
 assert len({r['email'] for r in records if r['email']})==len([r for r in records if r['email']])
 assert sum(r['favorite'] for r in records)==90
 for field in ('phone','email','company'): assert any(not r[field] for r in records)

def test_failed_import_rolls_back(tmp_path):
 db=tmp_path/'failure.db'
 create_app({'DATABASE':str(db),'TESTING':True})
 with sqlite3.connect(db) as c:
  c.execute("CREATE TRIGGER fail_seed BEFORE INSERT ON contacts WHEN NEW.notes LIKE '%:002]%' BEGIN SELECT RAISE(ABORT, 'test failure'); END")
 try: seed(db,True)
 except sqlite3.IntegrityError: pass
 else: raise AssertionError('expected insertion failure')
 with sqlite3.connect(db) as c: assert c.execute('select count(*) from contacts').fetchone()[0]==0
