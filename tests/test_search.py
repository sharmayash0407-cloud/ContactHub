"""Search tests use synthetic records in an isolated SQLite database."""

import pytest
from backend.app import create_app


@pytest.fixture
def client(tmp_path):
    app = create_app({"TESTING": True, "DATABASE": str(tmp_path / "search.db")})
    client = app.test_client()
    for values in [
        dict(name="Zeta Example", phone="+44 (0) 20 0000 1234", email="zeta@example.invalid", company="North Studio"),
        dict(name="alpha Example", phone="+49 0000 5678", email="alpha@example.invalid", company="South Lab"),
        dict(name="Beta Other", phone="000-000-9999", email="beta@example.invalid", company="100%_! Lab\\Works"),
    ]:
        assert client.post("/api/contacts", json={**values, "notes": "HiddenNotesOnly"}).status_code == 201
    return client


@pytest.mark.parametrize("query, expected", [
    ("alpha", ["alpha Example"]), ("ALPHA", ["alpha Example"]),
    ("eta Ex", ["Zeta Example"]), ("20 0000", ["Zeta Example"]),
    ("5678", ["alpha Example"]), ("ZETA@EXAMPLE", ["Zeta Example"]),
    ("north", ["Zeta Example"]), ("SOUTH LAB", ["alpha Example"]),
    ("  alpha  ", ["alpha Example"]), ("not-found", []),
    ("HiddenNotesOnly", []), ("%", ["Beta Other"]), ("_", ["Beta Other"]),
    ("!", ["Beta Other"]), ("%_!", ["Beta Other"]),
    ("!%", []), ("\\Works", ["Beta Other"]),
    ("EXAMPLE.INVALID", ["alpha Example", "Beta Other", "Zeta Example"]),
])
def test_search_matches_literal_partial_text(client, query, expected):
    response = client.get("/api/contacts", query_string={"search": query})
    assert response.status_code == 200
    assert set(response.json) == {"contacts"}
    assert [c["name"] for c in response.json["contacts"]] == expected


@pytest.mark.parametrize("query", ["", " ", " \t\n "])
def test_empty_query_is_the_original_unfiltered_list(client, query):
    assert client.get("/api/contacts", query_string={"search": query}).json == client.get("/api/contacts").json


def test_search_does_not_execute_sql_or_modify_contacts(client):
    dangerous = "Robert'); DROP TABLE contacts; --"
    added = client.post("/api/contacts", json={"name": dangerous})
    assert added.status_code == 201
    before = client.get("/api/contacts").json
    assert client.get("/api/contacts", query_string={"search": dangerous}).json == {"contacts": [added.json["contact"]]}
    assert client.get("/api/contacts", query_string={"search": "' OR 1=1 --"}).json == {"contacts": []}
    assert client.get("/api/contacts").json == before


def test_unicode_and_url_characters_are_literal(client):
    name = "Synthetic नमस्ते & + # ? % _ Example"
    created = client.post("/api/contacts", json={"name": name}).json["contact"]
    for query in ["नमस्ते", "& + # ? % _"]:
        assert client.get("/api/contacts", query_string={"search": query}).json == {"contacts": [created]}
