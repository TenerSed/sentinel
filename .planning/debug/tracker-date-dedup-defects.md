---
status: investigating
trigger: "Tracker rows have empty dates and duplicate/compound case identifiers; fix cache-backed paths and verify before deadline."
created: 2026-07-21
updated: 2026-07-21
---

## Symptoms

- Expected: `/api/cases` returns one canonical row per land-use case with a sourced `last_action_date` and human `last_action_label` whenever resolvable.
- Actual: all tracker dates render as a dash; duplicate VA cases and a compound `VA27 AND/OR VA28` row appear separately.
- Errors: no runtime exception reported; visible data-quality defects.
- Timeline: present in the current demo snapshot, roughly two hours before submission deadline.
- Reproduction: open `/tracker` or inspect `GET /api/cases`.

## Current Focus

- hypothesis: Cached case payloads lack SQLite event-date enrichment, while normalization only removes limited separators and never splits compound identifiers.
- test: Inspect graph identifiers, cache payloads, SQLite file/event joins, and current catalog deduplication.
- expecting: Dates resolve through source IDs for most cases; duplicates share canonical IDs or title/address identity.
- next_action: gather initial evidence

## Evidence


## Eliminated


## Resolution

- root_cause:
- fix:
- verification:
- files_changed:
