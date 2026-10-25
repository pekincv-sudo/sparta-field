# Public release 34 — 25 October 2026

Target: existing `sparta-field-u2pe` Vercel project, GitHub main branch.
Backend: existing Supabase project `klltykfmbsobqumpolyd`.

## Recovery

Before changes, source from production commit `bdd75d4` was archived to the
local task backups directory as `sparta-public-before-build34.tar.gz`.
`sparta-cloud-before-build34.json` contains the public-schema business records,
functions, access policies and storage object inventory before the upgrade.
It contains no auth credentials. The 18 historical storage objects are retained.

The company test archive uses label `before-public-build34-20261025` in the
private `sparta_archive.snapshots` table. An administrator can inspect its ID:

```sql
select id, company_id, label, saved_at, restored_at
from sparta_archive.snapshots
where label = 'before-public-build34-20261025';
```

To restore, first preserve any new work. The built-in restore deliberately
refuses a nonempty company, then restores the archived relational data:

```sql
select sparta_archive.restore_snapshot('snapshot UUID from the query above');
```

The archive function is idempotent by company/label: rerunning the release
cleanup with the same label does not remove newly entered records.

## Scope

- Authenticated staff workspace, owner-managed company access.
- Atomic object/technical/string saves, separate media revisions.
- Cloud warehouse documents, reservations, exact quantities and cost snapshots.
- Private company files and receipts; no public document buckets.
- Cash ledger with dated counterparties, purpose, project and linked reversals.
- Clean start without browser demo imports or seeded catalog.
- Client mode remains a preview for staff; no customer-specific authorization or
  live inverter integration is claimed.

## Validation

The standard test runner and real PostgreSQL migration tests cover role checks,
concurrent revisions, stock conservation, material valuation, media rollback,
checklist merging, cash reversals and complete archive/restore. Deployment and
live verification are recorded after applying the release.
