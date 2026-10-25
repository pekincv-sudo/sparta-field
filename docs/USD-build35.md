# USD as the primary currency — build 35

New projects, equipment catalog cards, receipts and cash entries default to USD.
UAH remains available. Contract, offer, labor, expense and material amounts use
the project's currency. A saved project or product cannot be relabeled into a
different currency. Create a separate card instead; no historical amounts are
converted by this release.

The cash journal stores currency with integer cents/kopiykas. Summary balances
and CSV exports preserve the denomination; USD and UAH are never added together.
Linked payments, reservations and warehouse movements must match the project's
currency. No exchange rate is assumed and cross-currency payments are rejected.
The solar estimate continues to use its explicitly labeled UAH/kWh tariff.

Apply `database/currency-usd-build35.sql` before releasing the frontend. It
updates the existing atomic project/warehouse RPCs and append-only cash
validation. Existing project/cash rows become UAH without changing amounts or
updating immutable cash history. Existing warehouse JSON history stays intact;
missing currency is interpreted as legacy UAH. Prior archived project snapshots
restore as UAH when they predate currency support. No business rows are deleted.

Validation: `node tests/run-tests.js` (203 checks); PGlite PostgreSQL suites
`currency.sql.test.js` (13), `project-save.sql.test.js` (12),
`warehouse-cloud.sql.test.js` (15), `release34.sql.test.js` (13). SQL tests require
`PGLITE_MODULE` and `SPARTA_BASE_SCHEMA` as documented in the release 34 notes.
Browser checks cover new-project USD, receipt USD/UAH switching and cash defaults.

Before release, source was backed up outside the public build as
`backups/sparta-before-usd-build35.tar.gz` in the working chat folder. Existing
private Supabase archives are retained. A code rollback alone is insufficient:
legacy clients require UAH defaults plus the old RPC/trigger definitions from
that source backup. Never roll back by relabeling any new USD records as UAH.
