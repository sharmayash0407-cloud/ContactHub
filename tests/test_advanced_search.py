"""Field search and sorting regressions; only isolated fictional records."""
import pytest
from backend.app import create_app
from backend.database import get_db

@pytest.fixture
def client(tmp_path):
    app=create_app({'TESTING':True,'DATABASE':str(tmp_path/'sort.db')})
    with app.app_context():
        db=get_db()
        db.executemany('INSERT INTO contacts(name,phone,email,company,notes,favorite,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',[
            ('Zulu', '000 %_', 'zulu@example.com','Alpha Labs','',1,'2025','2025'),
            ('Alpha', '000','alpha@example.org','Beta Labs','',0,'2026','2026'),
            ('Alpha', '000','third@example.net','','',1,'2026','2026'),
            ('Bravo', '', '', 'alpha labs','',1,'2024','2024')])
        db.commit()
    return app.test_client()

@pytest.mark.parametrize('field,query,ids',[('all','alpha',[2,3,4,1]),('name','ALP',[2,3]),('phone','%_',[1]),('email','third',[3]),('company','ALPHA',[4,1])])
def test_fields(client,field,query,ids):
    data=client.get('/api/contacts',query_string=dict(field=field,search=query,page=1)).json
    assert [r['id'] for r in data['contacts']]==ids
    assert data['pagination']['total']==len(ids)

@pytest.mark.parametrize('sort,ids',[('name_asc',[2,3,4,1]),('name_desc',[1,4,2,3]),('company_asc',[4,1,2,3]),('newest',[3,2,1,4]),('oldest',[4,1,2,3])])
def test_sorts(client,sort,ids):
    for extra in ({},{'page':1}):
        result=client.get('/api/contacts',query_string=dict(sort=sort,**extra)).json
        assert [r['id'] for r in result['contacts']]==ids

@pytest.mark.parametrize('query',['field=notes','field=','field=NAME','field=name&field=name','sort=','sort=NAME_ASC','sort=id','sort=newest&sort=oldest','sort=name;DROP%20TABLE%20contacts','field=name)%20OR%201=1--'])
def test_invalid(client,query):
    assert client.get('/api/contacts?'+query).status_code==400
    assert len(client.get('/api/contacts').json['contacts'])==4

def test_combinations_and_mutations(client):
    for i in range(70): client.post('/api/contacts',json={'name':f'Fixture {i:03}', 'company':'Demo Tech','favorite':True})
    query=dict(search='tech',field='company',sort='name_desc',favorite='true',page=2,page_size=25)
    data=client.get('/api/contacts',query_string=query).json
    assert data['pagination']==dict(page=2,page_size=25,total=70,total_pages=3)
    assert data['contacts'][0]['name']=='Fixture 044'
    ids=[]
    for page in (1,2,3): ids.extend(r['id'] for r in client.get('/api/contacts',query_string=query|{'page':page}).json['contacts'])
    assert len(ids)==len(set(ids))==70
    row=data['contacts'][0]
    edited={k:row[k] for k in ('name','company','email','phone','notes','favorite')}
    edited['name']='ZZZ Moved'
    client.put(f'/api/contacts/{row["id"]}',json=edited)
    assert client.get('/api/contacts',query_string=query|{'page':1}).json['contacts'][0]['name']=='ZZZ Moved'
    client.patch(f'/api/contacts/{row["id"]}/favorite',json={'favorite':False})
    assert client.get('/api/contacts',query_string=query).json['pagination']['total']==69
    client.delete(f'/api/contacts/{row["id"]}')
    assert client.get('/api/contacts',query_string=query).json['pagination']['total']==69

@pytest.mark.parametrize('field',['all','name','phone','email','company'])
def test_injection(client,field):
    assert client.get('/api/contacts',query_string=dict(search="' OR 1=1 --",field=field,sort='newest',page=1)).json['contacts']==[]

def test_null_company_sort(tmp_path):
    # The production schema forbids NULL. Exercise the defensive order on a legacy nullable table.
    app=create_app({'TESTING':True,'DATABASE':str(tmp_path/'nullable.db')})
    with app.app_context():
        db=get_db()
        db.execute('DROP TABLE contacts')
        db.execute('CREATE TABLE contacts(id INTEGER PRIMARY KEY,name TEXT,phone TEXT,email TEXT,company TEXT,notes TEXT,favorite INTEGER,created_at TEXT,updated_at TEXT)')
        db.executemany('INSERT INTO contacts VALUES(?,?,?,?,?,?,?,?,?)',[(1,'Alpha','','',None,'',0,'2026','2026'),(2,'Bravo','','','','',0,'2026','2026'),(3,'Charlie','','','Demo','',0,'2026','2026')])
        db.commit()
    assert [r['id'] for r in app.test_client().get('/api/contacts?sort=company_asc&page=1').json['contacts']]==[3,1,2]
