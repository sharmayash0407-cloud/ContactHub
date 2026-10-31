"""Nullable additive migration and optional location API tests."""
import sqlite3
import pytest
from backend.app import create_app

LEGACY='''CREATE TABLE contacts(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',email TEXT NOT NULL DEFAULT '',company TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',favorite INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)'''

def test_migrate_old_schema_and_repeat(tmp_path):
    path=tmp_path/'old.db'
    with sqlite3.connect(path) as db:
        db.execute(LEGACY)
        db.execute("INSERT INTO contacts VALUES(7,'Legacy Fiction','','','','',1,'2025','2026')")
        before=db.execute('select * from contacts').fetchall()
    for _ in range(2):
        app=create_app({'TESTING':True,'DATABASE':str(path)})
        row=app.test_client().get('/api/contacts/7').json['contact']
        assert row['city']==row['locality']==''
        with sqlite3.connect(path) as db:
            assert db.execute('select id,name,phone,email,company,notes,favorite,created_at,updated_at from contacts').fetchall()==before
            assert [r[1] for r in db.execute('pragma table_info(contacts)')].count('city')==1
            assert db.execute('select city,locality from contacts').fetchone()==(None,None)

@pytest.fixture
def client(tmp_path):
    return create_app({'TESTING':True,'DATABASE':str(tmp_path/'new.db')}).test_client()

def test_location_create_edit_clear_and_legacy_put(client):
    row=client.post('/api/contacts',json={'name':'Demo','city':'  Pune ','locality':' Model Colony '}).json['contact']
    assert (row['city'],row['locality'])==('Pune','Model Colony')
    legacy={k:row[k] for k in ('name','phone','email','company','notes','favorite')}
    assert client.put(f'/api/contacts/{row["id"]}',json=legacy).json['contact']['city']=='Pune'
    updated=client.put(f'/api/contacts/{row["id"]}',json=legacy|{'city':'Delhi','locality':'Demo Quarter'}).json['contact']
    assert updated['city']=='Delhi'
    cleared=client.put(f'/api/contacts/{row["id"]}',json=legacy|{'city':' ','locality':''}).json['contact']
    assert cleared['city']==cleared['locality']==''
    assert client.post('/api/contacts',json={'name':'No location'}).json['contact']['city']==''

@pytest.mark.parametrize('field,limit',[('city',100),('locality',200)])
@pytest.mark.parametrize('value',[None,42,False,[],{},'oversize'])
def test_invalid(client,field,limit,value):
    if value=='oversize': value='x'*(limit+1)
    assert client.post('/api/contacts',json={'name':'Demo',field:value}).status_code==400

@pytest.mark.parametrize('field',['all','city','locality'])
def test_location_search_filters_and_wildcards(client,field):
    for i in range(61): client.post('/api/contacts',json={'name':f'Demo {i:03}','city':'Demo %_ City','locality':'Demo %_ District','favorite':True})
    data=client.get('/api/contacts',query_string=dict(search='%_',field=field,sort='name_desc',favorite='true',page=2)).json
    assert data['pagination']['total']==61
    assert len(data['contacts'])==25
    assert data['contacts'][0]['name']=='Demo 035'
    assert client.get('/api/contacts',query_string=dict(search="' OR 1=1--",field=field)).json['contacts']==[]

@pytest.mark.parametrize('field,limit',[('city',100),('locality',200)])
def test_limits_and_invalid_edit_preserves_record(client,field,limit):
    made=client.post('/api/contacts',json={'name':'Boundary Demo',field:'x'*limit}).json['contact']
    body={k:made[k] for k in ('name','phone','email','company','notes','favorite','city','locality')}
    assert client.put(f'/api/contacts/{made["id"]}',json=body|{field:'x'*(limit+1)}).status_code==400
    assert client.get(f'/api/contacts/{made["id"]}').json['contact']==made

def test_fresh_columns_are_nullable(client):
    row=client.post('/api/contacts',json={'name':'Fresh Demo'}).json['contact']
    assert row['city']==row['locality']==''
