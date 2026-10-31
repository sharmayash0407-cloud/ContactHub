# ContactHub v1.1 release verification

Verified on 31 October 2026. Classification: **ready for local single-user portfolio use, with manual compatibility/accessibility checks outstanding**. This is not a production deployment or an accessibility certification. No reproducible application defect was found; no application code or dependencies were changed in this review.

## Fresh Windows installation

A clean archive of tracked commit `a960d36` was extracted under an ignored temporary workspace. It contained no development database, virtual environment or local data. The README commands `py -m venv .venv`, `.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt` and `.\.venv\Scripts\python.exe backend\app.py` were executed there successfully. The server loaded at `http://127.0.0.1:5000/`, initially showing the empty state and a new schema containing City and Locality. Flask was stopped and restarted; the synthetic fixture's stored fields and timestamps persisted exactly.

The source-copy step used a local Git archive rather than a second network clone. Authenticated `git ls-remote origin refs/heads/main` succeeded. Unauthenticated public repository access could not be confirmed by the web fetch tool; review public visibility separately before sharing the portfolio.

Actual runtime versions: Python 3.13.5, Flask 3.1.2, pytest 8.4.2, Node.js 20.10.0, Git 2.45.1.windows.1. These record the test environment rather than recommending older releases. The clean environment installed only the existing requirements, including their transitive dependencies.

## Workflows exercised

All write/delete checks used the temporary installation's SQLite database, never the development database.

| Check | Evidence |
|---|---|
| CRUD | Real HTTP POST/GET/PUT/DELETE, plus a browser-created, edited and confirmed-deleted temporary contact |
| Search | All seven supported selectors: all, name, phone, email, company, city, locality |
| Sorting | name_asc, name_desc, company_asc, newest, oldest through real HTTP requests; existing automated ordering/tie tests passed |
| Combined filters | City search + Favorites + descending name sort in browser; combined HTTP filters also checked |
| Pagination | 501 fictional records; every 25-row page enumerated without duplicate/missing IDs; 50-row option checked; browser Previous/Next and keyboard activation checked |
| Mutation position | Rename moved a fixture to the final alphabetical page; API and regression tests verified ordering and total counts |
| Last-page deletion | Separate 26-contact filtered fixture: deleting its only page-2 row clamped to page 1 |
| Location clearing | City/Locality explicitly cleared with PUT; existing UI regression tests also verified blank/long values |
| Favorites | PATCH toggles, filtered exclusion, browser filtering and accurate filtered totals |
| Persistence | Actual Flask process restart, followed by exact fixture field/timestamp comparison |

The gallery database contained 500 deterministic seeded fictional contacts plus AAA Portfolio Example. Locations were added only to this isolated database using Demo City/Example Quarter. Temporary workflow records were removed after checks. No source, personal data or unaided authorship claims were fabricated.

## Automated tests

- Existing environment: **210 Python tests passed in 7.54s; 151 JavaScript tests passed**, zero failures.
- Fresh virtual environment: **210 Python tests passed in 7.36s; 151 JavaScript tests passed**, zero failures.
- Tests use isolated databases and synthetic fixtures. No regression tests were added because no defect or uncovered release-blocking behavior was identified.

## Browser and accessibility scope

Actual browser tested: **Codex in-app browser**. Its exact engine version was not exposed through the available browser API, so no numeric browser version is claimed. Browser-internal version navigation was unavailable. No second browser engine was tested; Firefox was not found in the checked installation locations. Installed Chrome/Edge would share the Chromium engine and would not satisfy a second-engine check.

Actual page dimensions were confirmed from the DOM at **1440×900, 768×1024, 390×844 and 320×568**. Each showed 25 requested rows with no horizontal page overflow. Browser console inspection reported no errors. An initial viewport attempt affected a different tab; those observations were discarded and all four sizes were repeated on the correct tab.

Inspected semantic TABLE/TH markup, seven scoped column headers, row headers, native labels/selects, mobile field labels, status/live regions, pressed favorite states, confirmation naming and visible keyboard focus. Native modal dialogs hide the background from the accessibility tree. Escape, unsaved-change confirmation, safe Cancel focus, focus restoration and keyboard pagination were exercised. Full modal tab-cycle behavior, including browser chrome boundaries, remains a manual accessibility check alongside spoken navigation.

Representative CSS contrast calculations: muted text `#626e84` on white 5.14:1; table text `#536079` on white 6.33:1; white primary-button text on `#565cda` 5.33:1; selected star `#aa741b` on `#fff8e8` 3.80:1; focus ring `#6268e4` on white 4.55:1. This sampled review does not cover every hover/disabled combination. Desktop row controls are at least 36px high; mobile controls measured 44px high (Edit approximately 41px wide), exceeding 24px minimum target dimensions.

Windows Narrator is installed, but this automation session cannot listen to system speech. **No spoken screen-reader verification was performed.** A human Narrator/NVDA/VoiceOver pass is outstanding, especially table navigation in the stacked mobile view, dialog tab boundaries and live announcements. Other engines, physical mobile devices and high-zoom behavior also remain manual tasks. No render-time or frame-rate benchmark was measured during this review.

## Development database safety

The actual development database remained untouched throughout verification. Its SHA-256 before and after was `089A57079B0FCBB6819270757B18FF7197553C77CEB3AFC0D107C389DA246334`.

- SQLite integrity check returned `ok`.
- All **501 original records**, including IDs, favorite status, timestamps and original values, matched the pre-location-migration backup.
- Backup still available locally: `backend/backups/contacts-before-location-20261031T091320597799Z.db` (not committed).
- The backup's integrity check returned `ok`. Two initializations on a disposable copy confirmed migration idempotency and exact preservation of original columns.
- Fresh initialization created the new nullable location columns successfully.
- Database, backup, environment, cache and secret paths remain ignored and untracked.

## Documentation and manual release tasks

The root [README](../README.md) now presents v1.1 and five current synthetic screenshots. Earlier captures and the [development guide](DEVELOPMENT.md) remain available as historical documentation. Screenshot paths, local links and anchors were checked. Official prerequisite/license links resolved; authenticated Git access succeeded, while public repository visibility still needs human confirmation. Licensing remains unchanged.

Before claiming broad compatibility or formal accessibility: record a Firefox or WebKit version and repeat the primary workflow, perform spoken screen-reader checks, inspect high zoom and real mobile devices, and review public GitHub access. These limits do not prevent local single-user portfolio demonstration. Do not expose the unauthenticated development server publicly.
