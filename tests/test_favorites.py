"""Favorites use isolated SQLite files and synthetic contact details."""
import json
import pytest
from backend.app import create_app


@pytest.fixture
def client(tmp_path):
    return create_app({"TESTING": True, "DATABASE": str(tmp_path / "favorites.db")}).test_client()


def add(client, name="Synthetic Example", favorite=False, **fields):
    return client.post("/api/contacts", json={"name": name, "favorite": favorite, **fields}).json["contact"]


def test_patch_persists_and_changes_only_favorite_and_updated_timestamp(client):
    original = add(client, notes="Keep intact", email="synthetic@example.invalid")
    other = add(client, "Other Synthetic")
    url = f'/api/contacts/{original["id"]}/favorite'
    for value in (True, False):
        response = client.patch(url, json={"favorite": value})
        assert response.status_code == 200
        saved = response.json["contact"]
        assert saved["favorite"] is value
        assert saved["updated_at"] != original["updated_at"]
        assert {k: v for k, v in saved.items() if k not in ("favorite", "updated_at")} == {k: v for k, v in original.items() if k not in ("favorite", "updated_at")}
        assert client.get(f'/api/contacts/{original["id"]}').json["contact"] == saved
        assert client.get(f'/api/contacts/{other["id"]}').json["contact"] == other


def test_filter_search_and_crud_preserve_favorite_behavior(client):
    ordinary = add(client, "Alpha Ordinary", company="100%_! Lab")
    favorite = add(client, "Zeta Favorite", True, company="100%_! Lab")
    another = add(client, "Beta Favorite", True, company="Other Lab")
    assert client.get('/api/contacts?favorite=true').json == {"contacts": [another, favorite]}
    for query in ("%_!", "zeta", "ZETA"):
        assert client.get('/api/contacts', query_string={"favorite": "true", "search": query}).json == {"contacts": [favorite]}
    assert client.get('/api/contacts?favorite=true&search=ordinary').json == {"contacts": []}
    assert client.get('/api/contacts?favorite=false').json == client.get('/api/contacts').json
    updated = dict(name="Edited Favorite", phone="", email="", company="", notes="", favorite=True)
    assert client.put(f'/api/contacts/{favorite["id"]}', json=updated).json["contact"]["favorite"] is True
    assert client.delete(f'/api/contacts/{favorite["id"]}').status_code == 200
    assert client.get('/api/contacts?favorite=true').json == {"contacts": [another]}
    assert client.get(f'/api/contacts/{ordinary["id"]}').json["contact"] == ordinary


def test_empty_favorites_and_no_matching_favorites(client):
    add(client)
    assert client.get('/api/contacts?favorite=true').json == {"contacts": []}
    add(client, "Favorite Synthetic", True)
    assert client.get('/api/contacts?favorite=true&search=unmatched').json == {"contacts": []}


@pytest.mark.parametrize("payload", [{}, {"favorite": "true"}, {"favorite": 1}, {"favorite": 0}, {"favorite": None}, {"favorite": []}, {"favorite": True, "name": "Injected"}, [], None])
def test_invalid_patch_bodies_do_not_change_record(client, payload):
    original = add(client)
    response = client.patch(f'/api/contacts/{original["id"]}/favorite', data=json.dumps(payload), content_type="application/json")
    assert response.status_code == 400
    assert response.json["error"]["code"] == "validation_error"
    assert client.get(f'/api/contacts/{original["id"]}').json["contact"] == original


@pytest.mark.parametrize("contact_id", [0, 999, -1, "invalid", 9223372036854775808])
def test_missing_patch_id(client, contact_id):
    response = client.patch(f'/api/contacts/{contact_id}/favorite', json={"favorite": True})
    assert response.status_code == 404
    assert response.is_json


@pytest.mark.parametrize("query", ["favorite=", "favorite=1", "favorite=yes", "favorite=TRUE", "favorite=null", "favorite=true&favorite=false", "search=a&search=b"])
def test_invalid_query_parameters(client, query):
    response = client.get('/api/contacts?' + query)
    assert response.status_code == 400
    assert response.json["error"]["code"] == "validation_error"


def test_patch_json_errors(client):
    original = add(client)
    url = f'/api/contacts/{original["id"]}/favorite'
    assert client.patch(url, data="broken", content_type="application/json").json["error"]["code"] == "invalid_json"
    assert client.patch(url, data="favorite=true").status_code == 415


def test_favorite_survives_new_app_instance(tmp_path):
    config = {"TESTING": True, "DATABASE": str(tmp_path / "persistence.db")}
    client = create_app(config).test_client()
    contact = add(client)
    assert client.patch(f'/api/contacts/{contact["id"]}/favorite', json={"favorite": True}).status_code == 200
    reloaded = create_app(config).test_client()
    saved = reloaded.get('/api/contacts?favorite=true').json["contacts"]
    assert len(saved) == 1 and saved[0]["id"] == contact["id"] and saved[0]["favorite"] is True
