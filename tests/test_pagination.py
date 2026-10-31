"""Pagination uses isolated databases and fictional records only."""
import pytest
from backend.app import create_app
from backend.database import get_db

@pytest.fixture
def client(tmp_path):
    app = create_app({'TESTING': True, 'DATABASE': str(tmp_path/'pages.db')})
    with app.app_context():
        db = get_db()
        db.executemany('INSERT INTO contacts(name,phone,email,company,notes,favorite,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
            [(f'Fixture {i//2:03}', '000', f'fixture{i}@example.com', 'Literal %_ Labs' if i%2 else 'Other', '', i%3==0, '2026', '2026') for i in range(121)])
        db.commit()
    return app.test_client()

@pytest.mark.parametrize('query,page,size,length', [('page=1',1,25,25),('page=3',3,25,25),('page=5',5,25,21),('page=2&page_size=50',2,50,50),('page_size=50',1,50,50),('page=999',5,25,21)])
def test_pages(client,query,page,size,length):
    data=client.get('/api/contacts?'+query).json
    assert data['pagination']==dict(page=page,page_size=size,total=121,total_pages=(121+size-1)//size)
    assert len(data['contacts'])==length
    expected=sorted(client.get('/api/contacts').json['contacts'],key=lambda c:(c['name'].lower(),c['id']))
    assert data['contacts']==expected[(page-1)*size:page*size]

@pytest.mark.parametrize('query',['page=0','page=-1','page=01','page=1.0','page=abc','page=','page=+1','page=%201','page=١','page=99999999999','page=1&page=2','page_size=0','page_size=100','page_size=26','page_size=025','page_size=','page_size=25&page_size=25'])
def test_invalid(client,query):
    response=client.get('/api/contacts?'+query)
    assert response.status_code==400
    assert response.json['error']['code']=='validation_error'

@pytest.mark.parametrize('filters',['search=fixture','favorite=true','search=fixture&favorite=true','search=%25_','search=absent','search=%27%20OR%201=1--'])
def test_filtered_pages(client,filters):
    expected=client.get('/api/contacts?'+filters).json['contacts']
    data=client.get('/api/contacts?'+filters+'&page=2').json
    total=len(expected); page=min(2,max(1,(total+24)//25))
    assert data['pagination']['total']==total
    assert data['contacts']==expected[(page-1)*25:page*25]

def test_empty_and_compatibility(tmp_path,client):
    assert set(client.get('/api/contacts').json)=={'contacts'}
    app=create_app({'TESTING':True,'DATABASE':str(tmp_path/'empty.db')})
    data=app.test_client().get('/api/contacts?page=99').json
    assert data=={'contacts':[],'pagination':dict(page=1,page_size=25,total=0,total_pages=0)}

def test_mutations_last_page(client):
    records=client.get('/api/contacts').json['contacts']
    for row in records[101:]: assert client.delete(f'/api/contacts/{row["id"]}').status_code==200
    assert client.get('/api/contacts?page=5').json['pagination']['page']==5
    client.delete('/api/contacts/'+str(records[100]['id']))
    assert client.get('/api/contacts?page=5').json['pagination']==dict(page=4,page_size=25,total=100,total_pages=4)
    made=client.post('/api/contacts',json={'name':'AAA Fixture','favorite':True}).json['contact']
    assert client.get('/api/contacts?page=1').json['contacts'][0]['id']==made['id']
    client.put('/api/contacts/'+str(made['id']),json={k:made[k] for k in ('name','phone','email','company','notes','favorite')} | {'name':'ZZZ Fixture'})
    assert client.get('/api/contacts?page=5').json['contacts'][0]['name']=='ZZZ Fixture'
    client.patch(f'/api/contacts/{made["id"]}/favorite',json={'favorite':False})
    assert all(row['id']!=made['id'] for row in client.get('/api/contacts?page=1&favorite=true&search=ZZZ').json['contacts'])
