"""Final-review regressions use isolated databases and synthetic values."""
from html.parser import HTMLParser

from backend.app import create_app
from backend import models


def test_complete_workflow_survives_new_app_instances(tmp_path):
    config = {"TESTING": True, "DATABASE": str(tmp_path / "workflow.db")}
    client = create_app(config).test_client()
    untouched = client.post('/api/contacts', json={"name": "Unrelated Synthetic"}).json['contact']
    created = client.post('/api/contacts', json={"name": "Synthetic Review"})
    assert created.status_code == 201
    url = created.headers['Location']
    assert client.get(url).json == created.json
    fields = dict(name="Ada Synthetic Updated", phone="+44 0000 ext 12", email="review@example.invalid",
                  company="Example Lab", notes="Synthetic workflow", favorite=False)
    updated = client.put(url, json=fields)
    assert updated.status_code == 200
    client = create_app(config).test_client()
    assert client.get(url).json == updated.json
    starred = client.patch(url + '/favorite', json={"favorite": True})
    assert starred.status_code == 200
    assert client.get('/api/contacts', query_string={"favorite": "true", "search": "ADA"}).json == {"contacts": [starred.json['contact']]}
    assert client.patch(url + '/favorite', json={"favorite": False}).status_code == 200
    assert client.get('/api/contacts?favorite=true').json == {"contacts": []}
    assert client.delete(url).status_code == 200
    restarted = create_app(config).test_client()
    assert restarted.get(url).status_code == 404
    assert restarted.get('/api/contacts').json == {"contacts": [untouched]}


def test_unexpected_server_error_returns_generic_json(tmp_path, monkeypatch):
    app = create_app({"TESTING": True, "PROPAGATE_EXCEPTIONS": False,
                      "DATABASE": str(tmp_path / "errors.db")})

    def fail():
        raise RuntimeError("private internal detail")

    monkeypatch.setattr(models, "list_contacts", fail)
    response = app.test_client().get('/api/contacts')
    assert response.status_code == 500
    assert response.json == {"error": {"code": "internal_server_error", "message": "An unexpected server error occurred."}}
    assert 'private internal detail' not in response.get_data(as_text=True)


def test_live_status_labels_and_dialog_references_are_present(tmp_path):
    class Parser(HTMLParser):
        def __init__(self):
            super().__init__()
            self.ids = {}
            self.references = []

        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            if 'id' in attrs:
                assert attrs['id'] not in self.ids
                self.ids[attrs['id']] = attrs
            for attribute in ('for', 'aria-labelledby', 'aria-describedby'):
                self.references.extend(attrs.get(attribute, '').split())

    client = create_app({"TESTING": True, "DATABASE": str(tmp_path / 'markup.db')}).test_client()
    parser = Parser()
    parser.feed(client.get('/').get_data(as_text=True))
    assert all(reference in parser.ids for reference in parser.references)
    notice = parser.ids['save-notice']
    assert 'hidden' not in notice
    assert notice['role'] == 'status' and notice['aria-live'] == 'polite' and notice['aria-atomic'] == 'true'
    assert parser.ids['contact-name']['required'] is None
