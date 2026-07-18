# F1 Provenance Gap Fix

**Status:** fixed

Removed `indy-reporting-property-tax` from the committed fixture because its AP HTML URL had no real page or timestamp locator. Regenerated SQLite and the browser projection; the offline corpus now exposes only records with page-addressable documents or timestamped transcripts.
