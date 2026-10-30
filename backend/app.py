"""ContactHub's welcome page and contact API."""

from pathlib import Path
import re
import sqlite3
import sys

from flask import Flask, jsonify, request, url_for
from werkzeug.exceptions import BadRequest, HTTPException

# Support both direct execution and importing the app factory in tests.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.database import close_db, init_db
from backend import models

PROJECT_DIR = Path(__file__).resolve().parent.parent
TEXT_LIMITS = {"name": 200, "phone": 50, "email": 254, "company": 200, "notes": 5000}
EDITABLE_FIELDS = set(TEXT_LIMITS) | {"favorite"}


def error_response(code, message, status):
    return jsonify(error={"code": code, "message": message}), status


def validate_contact(data, require_all=False):
    """Check JSON types and return normalized, writable fields."""
    if not isinstance(data, dict):
        raise ValueError("The JSON body must be an object.")
    if set(data) - EDITABLE_FIELDS:
        raise ValueError("Unknown or read-only fields are not allowed.")
    if "name" not in data:
        raise ValueError("Name is required.")
    if require_all and EDITABLE_FIELDS - set(data):
        raise ValueError("PUT requires name, phone, email, company, notes, and favorite.")
    result = {}
    for field, limit in TEXT_LIMITS.items():
        value = data.get(field, "")
        if not isinstance(value, str):
            raise ValueError(f"{field} must be a string.")
        value = value.strip()
        if len(value) > limit:
            raise ValueError(f"{field} must be at most {limit} characters.")
        result[field] = value
    if not result["name"]:
        raise ValueError("Name must not be blank.")
    # Basic format validation, not an email deliverability check.
    if result["email"] and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", result["email"]):
        raise ValueError("Email must have a valid address format.")
    favorite = data.get("favorite", False)
    if not isinstance(favorite, bool):
        raise ValueError("favorite must be a JSON boolean.")
    result["favorite"] = favorite
    return result


def read_contact_body(require_all=False):
    if not request.is_json:
        return None, error_response("unsupported_media_type", "Use Content-Type: application/json.", 415)
    try:
        return validate_contact(request.get_json(), require_all), None
    except BadRequest:
        return None, error_response("invalid_json", "The request contains malformed JSON.", 400)
    except ValueError as error:
        return None, error_response("validation_error", str(error), 400)


def create_app(test_config=None):
    """Build the app; tests supply their own temporary database path."""
    app = Flask(__name__, static_folder=str(PROJECT_DIR / "frontend"), static_url_path="/static")
    app.config.from_mapping(DATABASE=str(PROJECT_DIR / "backend" / "contacts.db"))
    if test_config is not None:
        app.config.update(test_config)
    app.teardown_appcontext(close_db)

    @app.route("/")
    def index():
        return app.send_static_file("index.html")

    @app.get("/api/contacts")
    def contacts_list():
        return jsonify(contacts=[contact.to_dict() for contact in models.list_contacts()])

    @app.get("/api/contacts/<int:contact_id>")
    def contacts_get(contact_id):
        contact = models.find_contact(contact_id)
        if contact is None:
            return error_response("not_found", "Contact not found.", 404)
        return jsonify(contact=contact.to_dict())

    @app.post("/api/contacts")
    def contacts_create():
        data, error = read_contact_body()
        if error is not None:
            return error
        contact = models.create_contact(data)
        response = jsonify(contact=contact.to_dict())
        response.status_code = 201
        response.headers["Location"] = url_for("contacts_get", contact_id=contact.id)
        return response

    @app.put("/api/contacts/<int:contact_id>")
    def contacts_update(contact_id):
        if models.find_contact(contact_id) is None:
            return error_response("not_found", "Contact not found.", 404)
        data, error = read_contact_body(require_all=True)
        if error is not None:
            return error
        contact = models.update_contact(contact_id, data)
        if contact is None:
            return error_response("not_found", "Contact not found.", 404)
        return jsonify(contact=contact.to_dict())

    @app.delete("/api/contacts/<int:contact_id>")
    def contacts_delete(contact_id):
        if not models.delete_contact(contact_id):
            return error_response("not_found", "Contact not found.", 404)
        return jsonify(message="Contact deleted."), 200

    @app.errorhandler(HTTPException)
    def handle_http_error(error):
        # Preserve HTTP headers such as Allow on method errors.
        response = error.get_response()
        response.data = app.json.dumps({"error": {
            "code": error.name.lower().replace(" ", "_"), "message": error.description,
        }})
        response.content_type = "application/json"
        return response

    @app.errorhandler(sqlite3.Error)
    def handle_database_error(error):
        app.logger.exception("Database operation failed")
        return error_response("database_error", "Unable to complete the database operation.", 500)

    @app.errorhandler(500)
    def handle_server_error(error):
        return error_response("internal_server_error", "An unexpected server error occurred.", 500)

    with app.app_context():
        init_db()
    return app


if __name__ == "__main__":
    # Flask's built-in server is for local development only.
    create_app().run(host="127.0.0.1", port=5000)
