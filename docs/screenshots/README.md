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
