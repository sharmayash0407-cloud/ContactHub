"""API tests use temporary SQLite files, never the development database."""

from datetime import datetime
import json
from pathlib import Path
import sqlite3

import pytest
from backend.app import create_app


@pytest.fixture
def app(tmp_path):
    return create_app({"TESTING": True, "DATABASE": str(tmp_path / "contacts.db")})


@pytest.fixture
def client(app):
    return app.test_client()


def full_contact(**changes):
    data = dict(name="Asha Rao", phone="+91 9876543210", email="asha@example.com",
                company="Example", notes="Met at college", favorite=True)
    data.update(changes)
    return data


def assert_error(response, status, code):
    assert response.status_code == status
    assert response.is_json
    error = response.json["error"]
    assert error["code"] == code
    assert isinstance(error["message"], str) and error["message"]


def test_create_and_retrieve_all_fields(client):
    response = client.post("/api/contacts", json=full_contact())
    assert response.status_code == 201
    contact = response.json["contact"]
    assert isinstance(contact["id"], int) and contact["id"] > 0
    for key, value in full_contact().items():
        assert contact[key] == value
    assert contact["favorite"] is True
    assert datetime.fromisoformat(contact["created_at"]).utcoffset().total_seconds() == 0
    assert contact["updated_at"] == contact["created_at"]
    assert client.get(response.headers["Location"]).json == {"contact": contact}
    assert client.get("/api/contacts").json == {"contacts": [contact]}


def test_defaults_trimming_and_generated_ids(client):
    first = client.post("/api/contacts", json={"name": "  Asha  "}).json["contact"]
    second = client.post("/api/contacts", json={"name": "Dev"}).json["contact"]
    assert first["name"] == "Asha"
    assert first["favorite"] is False
    assert all(first[field] == "" for field in ("phone", "email", "company", "notes"))
    assert second["id"] > first["id"]
    assert len(client.get("/api/contacts").json["contacts"]) == 2


def test_empty_list(client):
    response = client.get("/api/contacts")
    assert response.status_code == 200
    assert response.json == {"contacts": []}


def test_update_all_fields_and_timestamps(client):
    original = client.post("/api/contacts", json=full_contact()).json["contact"]
    changed = full_contact(name="Dev", phone="", email="dev@example.org",
                           company="New company", notes="Updated", favorite=False)
    url = f'/api/contacts/{original["id"]}'
    response = client.put(url, json=changed)
    assert response.status_code == 200
    updated = response.json["contact"]
    for key, value in changed.items():
        assert updated[key] == value
    assert updated["favorite"] is False
    assert updated["id"] == original["id"]
    assert updated["created_at"] == original["created_at"]
    assert datetime.fromisoformat(updated["updated_at"]) > datetime.fromisoformat(original["updated_at"])
    assert client.get(url).json["contact"] == updated


def test_delete(client):
    created = client.post("/api/contacts", json=full_contact())
    url = created.headers["Location"]
    response = client.delete(url)
    assert response.status_code == 200
    assert response.json == {"message": "Contact deleted."}
    assert_error(client.get(url), 404, "not_found")
    assert_error(client.delete(url), 404, "not_found")
    assert client.get("/api/contacts").json == {"contacts": []}


@pytest.mark.parametrize("method", ["get", "put", "delete"])
@pytest.mark.parametrize("contact_id", [0, 999, -1, "invalid", 9223372036854775808])
def test_nonexistent_ids(client, method, contact_id):
    response = getattr(client, method)(f"/api/contacts/{contact_id}", json=full_contact())
    assert_error(response, 404, "not_found")


@pytest.mark.parametrize("payload", [
    {}, {"name": ""}, {"name": " \t "}, {"name": None}, {"name": 42},
    [], "text", None, {"name": "A", "id": 1}, {"name": "A", "created_at": "yesterday"},
    *[full_contact(**{field: value}) for field in ("phone", "email", "company", "notes")
      for value in (None, 123, [], {})],
    *[full_contact(favorite=value) for value in ("true", 1, 0, None, [])],
    full_contact(email="bad-email"), full_contact(email="a b@example.com"),
    full_contact(name="x" * 201), full_contact(phone="1" * 51),
    full_contact(email="a" * 250 + "@x.com"), full_contact(company="x" * 201),
    full_contact(notes="x" * 5001),
])
def test_invalid_create_does_not_insert(client, payload):
    response = client.post("/api/contacts", data=json.dumps(payload), content_type="application/json")
    assert_error(response, 400, "validation_error")
    assert client.get("/api/contacts").json == {"contacts": []}


@pytest.mark.parametrize("changes", [{"name": ""}, {"favorite": 1}, {"email": "invalid"}, {"notes": None}])
def test_invalid_update_leaves_contact_unchanged(client, changes):
    created = client.post("/api/contacts", json=full_contact())
    response = client.put(created.headers["Location"], json=full_contact(**changes))
    assert_error(response, 400, "validation_error")
    assert client.get(created.headers["Location"]).json == created.json


def test_put_requires_full_editable_record(client):
    created = client.post("/api/contacts", json=full_contact())
    assert_error(client.put(created.headers["Location"], json={"name": "Changed"}), 400, "validation_error")
    assert client.get(created.headers["Location"]).json == created.json


@pytest.mark.parametrize("method", ["post", "put"])
def test_malformed_json_and_wrong_content_type(client, method):
    url = "/api/contacts"
    if method == "put":
        url = client.post(url, json=full_contact()).headers["Location"]
    assert_error(getattr(client, method)(url, data='{broken', content_type="application/json"), 400, "invalid_json")
    assert_error(getattr(client, method)(url, data='name=Asha'), 415, "unsupported_media_type")


def test_sql_injection_strings_are_only_data(client):
    dangerous = "Robert'); DROP TABLE contacts; --"
    created = client.post("/api/contacts", json=full_contact(name=dangerous))
    assert created.status_code == 201
    url = created.headers["Location"]
    assert client.get(url).json["contact"]["name"] == dangerous
    assert client.put(url, json=full_contact(notes=dangerous)).status_code == 200
    assert client.get(url).json["contact"]["notes"] == dangerous
    assert client.delete(url).status_code == 200
    assert client.post("/api/contacts", json={"name": "Table still exists"}).status_code == 201


def test_persistence_across_app_instances(app, client):
    created = client.post("/api/contacts", json=full_contact())
    second_app = create_app({"TESTING": True, "DATABASE": app.config["DATABASE"]})
    assert second_app.test_client().get(created.headers["Location"]).json == created.json


def test_database_failure_is_json_and_hides_details(client, monkeypatch):
    from backend import models

    def fail(*args, **kwargs):
        raise sqlite3.OperationalError("private database path")

    monkeypatch.setattr(models, "list_contacts", fail)
    response = client.get("/api/contacts")
    assert_error(response, 500, "database_error")
    assert "private database path" not in response.get_data(as_text=True)


def test_unknown_route_and_method_are_json(client):
    assert_error(client.get("/api/missing"), 404, "not_found")
    response = client.patch("/api/contacts/1", json={})
    assert_error(response, 405, "method_not_allowed")
    assert "GET" in response.headers["Allow"]


@pytest.mark.parametrize("url, relative_path", [
    ("/", "index.html"), ("/static/css/style.css", "css/style.css"),
    ("/static/js/app.js", "js/app.js"), ("/static/js/api.js", "js/api.js"),
])
def test_frontend_still_served(client, url, relative_path):
    response = client.get(url)
    assert response.status_code == 200
    frontend = Path(__file__).resolve().parent.parent / "frontend"
    assert response.data == (frontend / relative_path).read_bytes()
