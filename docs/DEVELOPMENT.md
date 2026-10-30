# ContactHub Development Guide

Implementation notes and the local v1 quality review. Commands in this guide run from the repository root. See the [portfolio README](../README.md) for the current overview and [screenshot capture details](screenshots/README.md) for the real UI gallery.

Your contacts, organized simply.

ContactHub is a learning project that will help organize personal and professional contacts.

## Current status

Implemented: a responsive contact dashboard with Add, Edit, and confirmed Delete Contact actions backed by the Flask/SQLite CRUD API. The dashboard fetches real contacts, sorts them alphabetically, and displays names, phone numbers, emails, companies, initials, and accessible favorite toggle buttons. Loading, empty, error, and populated states are supported, including a working retry action. The shared accessible dialog creates and edits contacts through Flask, then refreshes the list and count. Delete buttons open a separate named confirmation dialog. Backend-powered search covers name, phone, email, and company. Favorite filtering works alongside search; authentication is not implemented.

## Planned technology stack

- HTML5, CSS3, vanilla JavaScript
- Python 3 and Flask
- SQLite (Python's built-in `sqlite3` module)
- pytest and Node.js built-in testing (development only)
- Git and GitHub

## Windows setup (PowerShell)

Open PowerShell in this ContactHub folder. Check prerequisites:

```powershell
py --version
git --version
node --version
```

If needed, install Python 3 from https://www.python.org/downloads/windows/ with the Python launcher enabled, and Git from https://git-scm.com/download/win. For JavaScript tests, install a maintained Node.js LTS release from https://nodejs.org/en/download. No npm packages are needed. Reopen PowerShell after installation. This project uses `py` because the `python` Windows alias may not work.

Create the environment once, then install dependencies:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

Activation is unnecessary: invoking the environment's Python directly avoids PowerShell execution-policy changes. On subsequent days, skip environment creation and start the server:

```powershell
.\.venv\Scripts\python.exe backend\app.py
```

Open http://127.0.0.1:5000 in your browser. Stop the server with **Ctrl+C**. Flask's development server is for local testing only.

## Structure and important code

- `frontend/index.html`: semantic dashboard, All Contacts/Favorites navigation, contact count, accessible status containers, shared Add/Edit Contact dialog, and deletion confirmation.
- `frontend/css/style.css`: layout, colors, and responsive styling.
- `frontend/js/api.js`: same-origin GET/POST requests to `/api/contacts`, PUT/DELETE requests to `/api/contacts/<id>`, and PATCH favorite updates, JSON response validation, and a 15-second timeout.
- `frontend/js/app.js`: alphabetical sorting, safe DOM rendering with `textContent`, initials, loading/empty/error/populated states, shared create/edit form validation/submission, and confirmed deletion. No contact values are inserted as HTML.
- `backend/app.py`: `Path(__file__)` locates the frontend independently of the terminal's working folder. `Flask(...)` creates the application and maps frontend assets to `/static`. `@app.route("/")` connects the home URL to `index()`, which sends the HTML file. The `__main__` guard starts the server only when this file is run directly.
- `backend/database.py`: opens request-scoped SQLite connections, creates the contacts table, and closes connections after requests. The database is created automatically at `backend/contacts.db` when the app starts; existing data is preserved.
- `backend/models.py`: the `Contact` dataclass represents one record. SQL operations use `?` placeholders to keep user values separate from SQL code. Transactions commit successful changes and roll back failed ones.
- `backend/requirements.txt`: reproducible dependency versions.
- `tests/test_contacts.py`: CRUD, validation, persistence, error handling, and frontend regression tests using isolated temporary databases.
- `tests/test_favorites.py`: strict favorite validation, persistence, combined filtering, and CRUD integration checks.
- `tests/test_search.py`: isolated SQLite search coverage, including literal wildcards and SQL injection regressions.
- `tests/test_dashboard.py`: dashboard/form-serving, field-limit consistency, and API/SQLite integration checks.
- `tests/test_quality.py`: complete API workflow/persistence, unexpected-error handling, and accessible markup regressions.
- `tests/frontend.test.cjs`: JavaScript request validation, DOM-state, form, and submission tests using Node’s built-in test runner, with no npm dependencies.

`create_app()` builds the application and accepts a configuration override for testing. This keeps test data out of your development database. The browser reads the API’s `{"contacts": [...]}` envelope. Unfiltered API lists retain their original ID order; search results use SQLite name ordering. The frontend consistently sorts all displayed results alphabetically by name. Timestamps are generated by the server in UTC; clients cannot set IDs or timestamps. SQLite stores favorites as 0/1, while the API returns JSON booleans.

## Creating a contact

Click **Add Contact**. Full Name is required; Phone Number, Email Address, Company, and Notes are optional. Favorite starts unchecked. Save Contact sends JSON to Flask. Only a confirmed **201 Created** response closes/resets the form and announces success. The dashboard then reloads the stored contacts, updates its count, and sorts names alphabetically.

The form trims text and uses the existing backend length limits. Email uses the same basic address format check as Flask. Phone validation only requires a digit and excludes control characters; international prefixes, punctuation, and extensions are allowed. Backend validation remains authoritative. Inline errors preserve input and focus the first invalid field.

The native dialog keeps the background inactive and supports keyboard navigation. Focus starts on Full Name and returns to Add Contact when closed. Cancel or Escape prompts an inline unsaved-change confirmation; Keep editing preserves input, and Discard changes resets the form. Saving disables inputs and action buttons, prevents repeated submissions, and blocks closing until the request finishes. The backdrop does not discard data.

Server-validation errors keep the form open. Network failures/timeouts can leave the result uncertain: the server may have saved before the response was lost, so check the list before retrying. If saving succeeds but refreshing fails, the notice explicitly says the contact was saved and offers the existing list retry. No contact data is written to localStorage. Unsaved form input is not preserved across a page reload or closing the browser tab. Duplicate contacts are allowed by the backend; this milestone prevents concurrent submissions from this form, not duplicates across tabs or later retries.

## Editing a contact

Click the **Edit** button on a card. The existing dialog switches to Edit Contact and prefills name, phone, email, company, notes, and favorite status from that record. Its database ID is held in JavaScript separately from form input so the update targets only that contact.

Save Changes validates all six editable fields with the same rules as Add Contact, then sends a full JSON record using **PUT `/api/contacts/<id>`**. POST creates a new record (201 Created); PUT updates the selected record (200 OK). Flask performs authoritative validation and SQLite updates the matching ID through parameterized SQL. The ID and created timestamp remain unchanged; the updated timestamp changes.

Only a confirmed successful response closes the form and announces an update. A fresh GET reloads the cards so names are sorted again, the count stays correct, and favorite indicators reflect saved values. Focus returns to that contact’s replacement Edit button, or Add Contact if the list fails to refresh. A successful update followed by a failed GET is reported as **updated, but unable to refresh**, with the list retry available.

Cancelling an unchanged edit closes immediately. Changes are compared with the original fields, including the favorite checkbox; Cancel/Escape asks before discarding. Failed validation or requests preserve edited values. A 404 explains that the record no longer exists. Network/server/malformed-response failures cannot confirm the update, so review the list before retrying. Raw server details are never shown. Simultaneous saves are blocked while the request is pending.

The form uses the dashboard’s latest loaded data; it does not detect another browser tab changing the same record. There is no concurrent-edit conflict detection in this milestone.

## Deleting a contact

Each card has a labeled **Delete** button. It opens a separate native dialog that names the selected contact and explains that deletion is permanent. The contact name is inserted with `textContent`. Cancel receives initial keyboard focus; Cancel and Escape close safely without sending any request. Opening the dialog never deletes a record.

Only explicitly activating **Delete** sends `DELETE /api/contacts/<id>` through the API module. The ID, not the name, selects the record, including when two contacts have the same name. While the request is pending, both actions are disabled, repeated requests are blocked, and Escape cannot close the dialog. The backend is unchanged: parameterized SQL deletes the matching ID and returns HTTP 200 with `{"message": "Contact deleted."}`.

A confirmed response closes the dialog and refreshes the list and count. Deleting the final contact displays the existing empty state. Focus returns to the triggering Delete button on cancellation, and to Add Contact after successful deletion because the old card no longer exists.

A 404 explains that the contact no longer exists. Server, network, timeout, or malformed-response failures never announce success; the dialog remains open with a warning that deletion may have succeeded and the list should be reloaded before retrying. If the DELETE succeeds but the subsequent GET fails, the page explicitly reports the successful deletion and failed refresh separately. Try again reloads the list without repeating the DELETE and clears that failure notice after recovery.

Deletion has no undo. Destructive tests use disposable databases and synthetic contacts, never the development database. No authentication or cloud services are added.

## Searching contacts

Use the labeled **Search contacts** input (placeholder: `Search contacts...`). The browser requests **GET `/api/contacts?search=QUERY`**, URL-encoding the trimmed query with `encodeURIComponent`. Filtering happens in Flask/SQLite, not in a cached JavaScript array. The response remains `{"contacts": [...]}`.

Search finds a partial match in **name, phone, email, or company**. It does not search notes. Empty or whitespace-only queries return the unfiltered list. SQLite `LIKE` performs case-insensitive matching for ASCII text; Unicode text can match literally, but full Unicode case folding and accent-insensitive matching are not supported. Phone searches match stored text, without normalizing spaces, punctuation, or country prefixes.

SQL values are passed through `?` parameters. Separately, `%`, `_`, and the escape character `!` are escaped so they are searched literally, rather than acting as SQL pattern wildcards. Only the surrounding `%` added by the application means “match anywhere.” Filtered responses sort by name using `COLLATE NOCASE`, with ID as a tie-breaker. Existing unfiltered API ordering remains unchanged for compatibility; the frontend sorts all displayed lists alphabetically.

A **300 ms debounce** resets a timer on each meaningful query change, sending a request after typing pauses. Changes consisting only of surrounding whitespace do not cause another request. Enter sends a pending search immediately. Clear search or Escape resets the query; retries and CRUD refreshes preserve the current query. A contact renamed so it no longer matches disappears from the filtered results after refresh.

Every query change invalidates older results immediately, including during the debounce delay. Request version numbers prevent late successes or failures from replacing the current state. Requests still have a 15-second timeout; older in-flight requests may finish, but their results are ignored.

The summary switches from **Total contacts** to **Matching contacts** while searching, and an accessible result message reports the count. No matching contacts is distinct from the unfiltered empty-database state. Errors preserve the query and offer Try again. Search values and contact data use `textContent`, never HTML insertion. Queries are not saved in localStorage or in the page URL; reloading the page resets search. Search text is transmitted in the API URL and may appear in local development request logs.

## Favorites

Every contact card has a keyboard-accessible star button labeled with its contact name. `aria-pressed="true"` means it is a favorite; a filled gold star also distinguishes the saved state. Click or use Space/Enter to mark or unmark it. The button sends **PATCH `/api/contacts/<id>/favorite`** with exactly `{"favorite": true}` or `{"favorite": false}`. HTTP 200 returns `{"contact": {...}}`. This endpoint updates only favorite status and the updated timestamp, preserving other fields and the created timestamp.

Favorite must be a JSON boolean: strings, numbers, nulls, missing or extra fields are rejected with JSON 400 errors. Malformed JSON returns 400, unsupported content types 415, and missing contacts 404. No new database table or dependency is required.

**Favorites** navigation loads **GET `/api/contacts?favorite=true`**. Search combines with it as **GET `/api/contacts?search=QUERY&favorite=true`**. The SQL groups the four search fields together and ANDs them with the favorite condition; all user values remain parameterized. `favorite=false` or an omitted parameter means the full list, not a non-favorites-only list. The query parameter accepts only lowercase `true`/`false`; blank, unknown values, or duplicate favorite/search parameters return JSON 400 errors. Other existing query parameters remain ignored for compatibility.

The entered search is retained when switching views, clearing search keeps the active view, and retries and CRUD refreshes retain both filters. Counts describe the displayed results. Empty Favorites and no matching favorites have distinct messages. Add/Edit checkboxes and Delete continue to work in both views.

The star changes only after Flask confirms it. While a request is pending, duplicate toggles and the same card’s Edit/Delete actions are disabled. Newer list requests take precedence over older responses. Refreshing the cards after confirmation shows current persisted values; unfavoriting in Favorites removes that card. Focus returns to its replacement star button, or the active navigation button when the card is gone. A failed request preserves the last confirmed star state and warns that an interrupted response may leave the result uncertain. Missing contacts get a clear message. A confirmed favorite change followed by failed refresh is reported separately; list retry does not repeat PATCH.

View/search choices reset on page reload. Favorites themselves persist in SQLite. No cross-tab synchronization or concurrent-edit conflict resolution is implemented.

## Contact API

| Method | Path | Successful response |
|---|---|---|
| GET | `/api/contacts` | 200: `{"contacts": [...]}` in ID order |
| GET | `/api/contacts?search=QUERY` | 200: `{"contacts": [...]}` filtered by literal partial match |
| GET | `/api/contacts?favorite=true` | 200: `{"contacts": [...]}` containing only favorites; combines with search |
| PATCH | `/api/contacts/<id>/favorite` | 200: `{"contact": {...}}` after setting a strict boolean |
| GET | `/api/contacts/<id>` | 200: `{"contact": {...}}` |
| POST | `/api/contacts` | 201: `{"contact": {...}}`, plus a Location header |
| PUT | `/api/contacts/<id>` | 200: `{"contact": {...}}` |
| DELETE | `/api/contacts/<id>` | 200: `{"message": "Contact deleted."}` |

POST and PUT require `Content-Type: application/json` and an object body. POST requires a nonblank `name`; omitted optional text fields default to empty strings and `favorite` defaults to false. PUT replaces all editable fields, so it requires all six fields:

```json
{
  "name": "Asha Rao",
  "phone": "+91 9876543210",
  "email": "asha@example.com",
  "company": "Example",
  "notes": "Met at college",
  "favorite": false
}
```

Text is trimmed. Maximum lengths: name/company 200, phone 50, email 254, notes 5000 characters. Email may be empty; otherwise a basic address format is required. Phone remains a string to preserve `+`, spaces, and leading zeros. `favorite` must be a JSON boolean. Nulls, unknown fields, and client-supplied IDs/timestamps are rejected. Email uniqueness is not required.

Returned contacts also contain generated `id`, `created_at`, and `updated_at`. Errors consistently use `{"error": {"code": "...", "message": "..."}}`: 400 for invalid input or malformed JSON, 404 for missing contacts/routes, 405 for unsupported methods, 415 for unsupported request content types, and 500 for database/server failures. PUT checks existence before validating its body. Database error details are logged locally and withheld from responses.

**Local, single-user application only.** The documented startup binds to `127.0.0.1` with Flask debug mode off. Do not expose it publicly without appropriate security protections and a separate deployment review. Authentication, production hardening, and concurrent-user access controls are not implemented.

## Automated tests

From the ContactHub root:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Tests create temporary SQLite databases and do not modify `backend/contacts.db`. If a restricted execution environment blocks its default temporary folder, use a process-local override:

```powershell
New-Item -ItemType Directory -Force .venv\tmp | Out-Null
$env:TEMP = (Resolve-Path .venv\tmp).Path
$env:TMP = $env:TEMP
.\.venv\Scripts\python.exe -m pytest -q
```

## Dashboard tests and manual verification

JavaScript tests require a maintained Node.js release with its built-in test runner (development only; API compatibility requires Node.js 18 or newer):

```powershell
node --test tests/frontend.test.cjs
```

The JavaScript tests use synthetic data and a small DOM stand-in; they do not replace actual browser layout checks. The dashboard has been inspected at desktop and mobile widths. To check it yourself, run Flask, open the home page, and confirm the count/cards match `GET /api/contacts`. With an empty database, expect an empty-state message and a zero count. Browser network throttling can reveal loading; stopping Flask and clicking Try again after a failed request verifies recovery. There are no hardcoded demo contacts in the frontend.

Optional phone/email/company fields use clear fallback text. Favorite stars are buttons with `aria-pressed`, reflecting the last confirmed saved value. Contact data is shown as plain text; notes are editable in the dialog but not displayed on cards; timestamps are not displayed. The dashboard loads on each page visit, debounced search, retry, and confirmed contact creation/update/deletion, without automatic polling or pagination.

## HTTP verification

With the server running, use a second PowerShell window:

```powershell
(Invoke-WebRequest http://127.0.0.1:5000/).StatusCode
(Invoke-WebRequest http://127.0.0.1:5000/static/css/style.css).StatusCode
```

Both should return `200`. Check that the page is styled, resize the browser to a narrow width, and inspect the server terminal for errors.

## Git workflow

This folder has its own repository, separate from the surrounding stock research workspace. Git records versions of your code; a repository stores that history. `git add` selects the next snapshot and `git commit` records it locally. `.gitignore` keeps environments, caches, databases, and secrets out of new snapshots.

Review before committing:

```powershell
git status --short --untracked-files=all
git check-ignore .venv/ .env sample.db
git add .gitignore README.md frontend backend tests
git diff --cached --stat
git diff --cached
git commit -m "chore: initialize ContactHub project"
```

Check staged content for secrets before the commit. If Git asks for your identity, set your own details locally (replace the examples):

```powershell
git config user.name "Your Name"
git config user.email "your-email@example.com"
```

Only push new milestones to GitHub after review and explicit permission.

## Local v1 quality review — 30 October 2026

The review used isolated synthetic databases and left `backend/contacts.db` unchanged. Final automated verification: **129 pytest tests and 132 JavaScript tests passed**. Tests include CRUD, persistence, input/JSON validation, SQL injection regressions, literal wildcard search, favorites/search integration, duplicate requests, stale responses, and network/server/malformed-response handling. The JavaScript tests use a DOM stand-in; browser inspection provides separate visual evidence.

A complete browser workflow created a contact, edited it, marked it as a favorite, searched in Favorites, unmarked it, returned to All Contacts, and deleted it after confirmation. HTTP comparisons verified cancelled edits/deletions did not change stored records. Deletion stayed absent after actually stopping and restarting Flask against the same isolated database; the unrelated record remained unchanged.

Dashboard/form/modal layouts were inspected at **1440×900, 768×1024, 390×844, and 320×568**, without horizontal overflow. Keyboard checks covered field order, modal isolation, Escape/discard behavior, safe deletion cancellation, star activation, and focus restoration. Retry recovery and successful updates followed by failed list refreshes were also exercised. No unexpected JavaScript console errors were observed; intentionally simulated server failures were expected.

Confirmed issues fixed during review:

- Incomplete successful create/favorite response data could be accepted. All contact response paths now share validation for the fields used by the dashboard/form.
- Successful list retry left outdated create/edit refresh-failure messages. Recovery now updates those messages accurately.
- Retry disappeared after recovery without restoring focus. Focus now moves to the search input.
- Small muted text had measured contrast ratios as low as 2.73:1. Reviewed main text pairs now measure 4.85:1–5.14:1; input boundaries were strengthened, and action buttons have a 44px minimum height.
- The mutation status region started hidden. It now remains present with polite, atomic announcements so the first status update can be detected. Actual spoken output was not tested with NVDA or another screen reader.

The app has no animations or transitions requiring a reduced-motion override. This is a manual accessibility review with regression tests, not a formal accessibility certification. Additional browser engines, real mobile devices, high zoom, and actual screen-reader output remain manual verification work.

## Known limitations and portfolio presentation

- Local single-user use only; no authentication or public deployment hardening.
- No concurrent-edit conflict detection or automatic cross-tab synchronization.
- Search case-insensitivity is limited to ASCII; phone searches use the stored formatting.
- No undo for deletion. Interrupted mutation responses can leave results uncertain; the UI explains when to reload before retrying.
- Unsaved input and view/search selections reset on page reload; contact data and favorites persist in SQLite.
- No pagination or automatic polling; very large datasets have not been performance tested.

For an honest portfolio presentation, include the implemented feature list, test commands, local-only scope, and these limitations. Recommended **real** screenshots use synthetic contacts: the populated dashboard, combined search/Favorites view, labeled Add/Edit dialog, and named Delete confirmation. Screenshots and a demonstration should never show personal contact data. Choose a project license before describing reuse rights; no license is supplied by this review.

## Planned future features

CRUD, search, and favorites are implemented and have completed the local v1 quality review. Next steps are manual screen-reader and additional-browser checks, a short synthetic-data demonstration, and repository presentation; new features can be planned separately.
