"""Serving integration checks; all contact values here are synthetic."""

from html.parser import HTMLParser
from backend.app import create_app


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []
        self.ids = set()

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "script":
            self.scripts.append(values.get("src"))
        if "id" in values:
            self.ids.add(values["id"])


def test_dashboard_and_api_share_the_flask_origin(tmp_path):
    app = create_app({"TESTING": True, "DATABASE": str(tmp_path / "dashboard.db")})
    client = app.test_client()
    page = client.get("/")
    assert page.status_code == 200
    parser = PageParser()
    parser.feed(page.get_data(as_text=True))
    assert parser.scripts == ["/static/js/api.js", "/static/js/app.js"]
    assert {"contact-list", "contacts-region", "contact-count", "retry-button"} <= parser.ids
    for script in parser.scripts:
        assert client.get(script).status_code == 200
    created = client.post("/api/contacts", json={
        "name": "Synthetic Dashboard Example", "email": "dashboard@example.invalid",
        "favorite": True,
    })
    assert created.status_code == 201
    assert client.get("/api/contacts").json == {"contacts": [created.json["contact"]]}
