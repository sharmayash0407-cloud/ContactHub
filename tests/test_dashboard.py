"""Serving integration checks; all contact values here are synthetic."""

from html.parser import HTMLParser
from backend.app import create_app


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []
        self.ids = set()
        self.fields = {}

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "script":
            self.scripts.append(values.get("src"))
        if "id" in values:
            self.ids.add(values["id"])
            self.fields[values["id"]] = values


def test_dashboard_and_api_share_the_flask_origin(tmp_path):
    app = create_app({"TESTING": True, "DATABASE": str(tmp_path / "dashboard.db")})
    client = app.test_client()
    page = client.get("/")
    assert page.status_code == 200
    parser = PageParser()
    parser.feed(page.get_data(as_text=True))
    assert parser.scripts == ["/static/js/api.js", "/static/js/app.js"]
    assert {"contact-list", "contacts-region", "contact-count", "retry-button"} <= parser.ids
    assert {"search-form", "contact-search", "clear-search", "search-results", "count-label"} <= parser.ids
    assert parser.fields["contact-search"]["type"] == "search"
    assert parser.fields["contact-search"]["placeholder"] == "Search contacts..."
    assert {"nav-all", "nav-favorites", "page-title", "breadcrumb-title"} <= parser.ids
    assert parser.fields["nav-all"]["aria-pressed"] == "true"
    assert parser.fields["nav-favorites"]["aria-pressed"] == "false"
    for script in parser.scripts:
        assert client.get(script).status_code == 200
    created = client.post("/api/contacts", json={
        "name": "Synthetic Dashboard Example", "email": "dashboard@example.invalid",
        "favorite": True,
    })
    assert created.status_code == 201
    assert client.get("/api/contacts").json == {"contacts": [created.json["contact"]]}


def test_creation_form_matches_backend_limits_and_persists_fields(tmp_path):
    from backend.app import TEXT_LIMITS

    config = {"TESTING": True, "DATABASE": str(tmp_path / "creation.db")}
    client = create_app(config).test_client()
    parser = PageParser()
    parser.feed(client.get("/").get_data(as_text=True))
    assert {"contact-dialog", "contact-form", "add-contact", "save-contact", "cancel-contact"} <= parser.ids
    for field, limit in TEXT_LIMITS.items():
        assert parser.fields[f"contact-{field}"]["maxlength"] == str(limit)
    assert "required" in parser.fields["contact-name"]
    assert "checked" not in parser.fields["contact-favorite"]
    data = dict(name="Synthetic Form Example", phone="+44 (0) 20 0000 0000 ext 12",
                email="form@example.invalid", company="Example Lab", notes="Synthetic notes", favorite=True)
    created = client.post("/api/contacts", json=data)
    assert created.status_code == 201
    saved = created.json["contact"]
    for key, value in data.items():
        assert saved[key] == value
    # A new app instance reads the same record from SQLite.
    assert create_app(config).test_client().get("/api/contacts").json == {"contacts": [saved]}


def test_edit_persists_only_selected_contact_and_preserves_count(tmp_path):
    config = {"TESTING": True, "DATABASE": str(tmp_path / "editing.db")}
    client = create_app(config).test_client()
    first = client.post("/api/contacts", json={"name": "Zeta Synthetic", "notes": "Existing notes"}).json["contact"]
    other = client.post("/api/contacts", json={"name": "Beta Synthetic", "notes": "Leave unchanged"}).json["contact"]
    changed = dict(name="Alpha Synthetic", phone="+49 (0) 0000 ext 12", email="edit@example.invalid",
                   company="Example Lab", notes="Edited synthetic notes", favorite=True)
    result = client.put(f'/api/contacts/{first["id"]}', json=changed)
    assert result.status_code == 200
    edited = result.json["contact"]
    assert edited["id"] == first["id"]
    assert edited["created_at"] == first["created_at"]
    assert edited["updated_at"] != first["updated_at"]
    for key, value in changed.items():
        assert edited[key] == value
    records = create_app(config).test_client().get("/api/contacts").json["contacts"]
    assert records == [edited, other]


def test_delete_preserves_same_named_contact_and_persists_empty_state(tmp_path):
    config = {"TESTING": True, "DATABASE": str(tmp_path / "deletion.db")}
    client = create_app(config).test_client()
    parser = PageParser()
    parser.feed(client.get("/").get_data(as_text=True))
    assert {"delete-dialog", "delete-name", "cancel-delete", "confirm-delete", "delete-error"} <= parser.ids
    assert parser.fields["cancel-delete"]["type"] == "button"
    assert parser.fields["confirm-delete"]["type"] == "button"
    first = client.post("/api/contacts", json={"name": "Synthetic Same Name"}).json["contact"]
    other = client.post("/api/contacts", json={"name": "Synthetic Same Name", "notes": "Keep intact"}).json["contact"]
    response = client.delete(f'/api/contacts/{first["id"]}')
    assert response.status_code == 200
    assert response.json == {"message": "Contact deleted."}
    assert client.get(f'/api/contacts/{first["id"]}').status_code == 404
    assert create_app(config).test_client().get("/api/contacts").json == {"contacts": [other]}
    assert client.delete(f'/api/contacts/{first["id"]}').status_code == 404
    assert client.delete(f'/api/contacts/{other["id"]}').status_code == 200
    assert create_app(config).test_client().get("/api/contacts").json == {"contacts": []}
