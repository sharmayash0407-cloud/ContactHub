# Screenshot provenance

Captured on 30 October 2026 from the actual ContactHub v1 Flask application running locally. These are direct browser screenshots, not generated mockups or edited UI composites.

The preview used a newly created, disposable SQLite database outside `backend/contacts.db`. It contained six fictional contacts: Alex Example, Blair Sample, Casey Demo, Devon Example, Ellis Sample, and Finley Demo. Every phone value was `000-000-0000`; every email used the reserved `example.invalid` domain. Notes explicitly identify demonstration data. No user database or personal contacts were used, copied, or published.

| File | View | Requested browser viewport | Native JPEG dimensions |
|---|---|---|---|
| [desktop-dashboard.jpg](desktop-dashboard.jpg) | All six contacts, full page | 1440×900 | 1424×1264 |
| [add-contact.jpg](add-contact.jpg) | Empty Add Contact dialog | 1440×900 | 1425×891 |
| [edit-contact.jpg](edit-contact.jpg) | Existing fictional Alex Example contact | 1440×900 | 1425×891 |
| [favorites.jpg](favorites.jpg) | Three favorite contacts | 1440×900 | 1440×900 |
| [mobile-dashboard.jpg](mobile-dashboard.jpg) | Responsive All Contacts view | 390×1000 | 375×961 |

The capture tool returned JPEG bytes; files use matching `.jpg` extensions. Native captures can differ from the requested viewport/content dimensions. The image bytes were preserved without retouching or resizing. Browser chrome and unrelated apps are not included.

No contact was created or edited through the screenshot dialogs. They were opened and cancelled; the demonstration records came only from the disposable fixture. This fixture and its database are not part of the application startup or the tracked source.

[Back to the portfolio README](../../README.md)

## v1.1 responsive table milestone — 31 October 2026

- `responsive-table-desktop.jpg`: actual browser capture requested at 1440×900; semantic table with 500 fictional seeded contacts.
- `responsive-table-mobile.jpg`: actual browser capture requested at 390×844; the same records and controls in stacked rows.

These two captures used a separate disposable SQLite database, not the development database. An additional synthetic long-name/email fixture was created, edited, favorited and deleted during checks; the database returned to 500 records before the mobile capture. No real contact information is present. These screenshots document the table milestone; the original gallery above documents v1 cards.

Browser checks covered 1440×900, 768×1024, 390×844 and 320×568 without horizontal page overflow. A sampled desktop row measured 56.4 CSS pixels high. Scrolling, search, favorites, create/edit/delete, Escape and focus restoration were checked. No console errors were observed. Rendering duration and frame rate were not separately measured. Screen-reader speech and other browser engines remain unverified.
