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
TEXT_LIMITS = {"name": 200, "phone": 50, "email": 254, "company": 200, "notes": 5000, "city": 100, "locality": 200}
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
    if require_all and (EDITABLE_FIELDS - {"city", "locality"}) - set(data):
        raise ValueError("PUT requires name, phone, email, company, notes, and favorite.")
    result = {}
    for field, limit in TEXT_LIMITS.items():
        if require_all and field in ("city", "locality") and field not in data:
            continue  # Older PUT clients preserve existing location values.
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
        if len(request.args.getlist("favorite")) > 1 or len(request.args.getlist("search")) > 1:
            return error_response("validation_error", "Search and favorite parameters must appear only once.", 400)
        favorite = request.args.get("favorite", "false")
        if favorite not in ("true", "false"):
            return error_response("validation_error", "favorite must be true or false.", 400)
        for key, allowed, default in (("field", models.SEARCH_FIELDS, "all"), ("sort", models.SORT_ORDERS, "name_asc")):
            if len(request.args.getlist(key)) > 1 or request.args.get(key, default) not in allowed:
                return error_response("validation_error", f"{key} must appear once and be one of: {', '.join(allowed)}.", 400)
        field = request.args.get("field", "all")
        sort = request.args.get("sort")
        query = request.args.get("search", "").strip()
        if "page" in request.args or "page_size" in request.args:
            for key in ("page", "page_size"):
                values = request.args.getlist(key)
                value = request.args.get(key, "1" if key == "page" else "25")
                if len(values) > 1 or not re.fullmatch(r"[1-9][0-9]{0,9}", value):
                    return error_response("validation_error", f"{key} must be a positive integer supplied once.", 400)
            page = int(request.args.get("page", "1"))
            page_size = int(request.args.get("page_size", "25"))
            if page_size not in (25, 50):
                return error_response("validation_error", "page_size must be 25 or 50.", 400)
            contacts, pagination = models.list_contacts(query, favorite == "true", page, page_size, field, sort)
            return jsonify(contacts=[contact.to_dict() for contact in contacts], pagination=pagination)
        contacts = models.list_contacts(query, favorite == "true", field=field, sort=sort)
        return jsonify(contacts=[contact.to_dict() for contact in contacts])

    @app.patch("/api/contacts/<int:contact_id>/favorite")
    def contacts_favorite(contact_id):
        if not request.is_json:
            return error_response("unsupported_media_type", "Use Content-Type: application/json.", 415)
        try:
            data = request.get_json()
        except BadRequest:
            return error_response("invalid_json", "The request contains malformed JSON.", 400)
        if not isinstance(data, dict) or set(data) != {"favorite"} or not isinstance(data["favorite"], bool):
            return error_response("validation_error", "Provide only favorite as a JSON boolean.", 400)
        contact = models.set_favorite(contact_id, data["favorite"])
        if contact is None:
            return error_response("not_found", "Contact not found.", 404)
        return jsonify(contact=contact.to_dict())

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
