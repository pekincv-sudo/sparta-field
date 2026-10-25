# Team access and activity — build 36

Each person uses their own Supabase Auth email/password. The gate now exposes
registration with name and password confirmation, confirmation resend and
password recovery. An invite/recovery callback asks the signed-in person to set
their own password. No password is stored in business tables or the activity log.

| Role | Access |
| --- | --- |
| Власник (`owner`) | Company, finance/cash, staff access, audit |
| Адміністратор (`admin`) | Operations, finance/cash, subordinate staff, audit; owner/admin grants require owner |
| Менеджер (`engineer`) | CRM, object cards, technical information and material plans |
| Майстер (`brigadier`), Монтажник (`installer`) | Installation checklist, photos/files, status and notes of assigned tasks |
| Комірник (`warehouse`) | Inventory, receipts, reserves and stock movements |
| Перегляд (`viewer`) | Read only |

Private project finance is masked by `sparta_project_list`; direct finance-column
reads are denied. Cash remains owner/admin scoped. Stock prices and ordinary
company object documents remain shared company information. Role/deactivation
checks apply at the database, and the browser refreshes membership on focus and
once per minute. Previously downloaded data cannot be removed from a person's
device by changing their role.

`Команда і події` lists people, effective roles, active/suspended access, last
recorded application login, pending/accepted/revoked/expired invitations, and
filterable history. Before/after snapshots identify actors using the actual
authenticated user, with verified email and role snapshots. Collection rewrites
are coalesced within a transaction so an unchanged object save does not invent
photo/string/material delete/create events. Committed history is immutable.
The log starts when this migration is installed; old unrecorded edits cannot be
reconstructed. Login events are deduplicated by the actual Auth session. Logout
is recorded for an explicit connected sign-out, not a closed/offline browser.

Apply `database/team-build36.sql` before releasing build 36. It changes no actual
member roles and sends no messages. It includes current project/warehouse RPC
role restrictions and `team-access-audit.sql`. Existing accounts, USD/UAH amounts
and private test archives are preserved. Source backup is in the chat's backup
folder as `sparta-before-team-build36.tar.gz`.

Validation: 244 app/service-adapter checks; 29 PostgreSQL team/audit/role checks;
12 project-save, 15 warehouse, 13 release/archive PostgreSQL checks. All run on
isolated fixtures; invitation endpoint tests mock delivery and send no real mail.

## Required mail configuration

The existing Vercel production project currently lacks
`SUPABASE_SERVICE_ROLE_KEY`. The Supabase project currently uses its built-in
test email service. To complete reliable staff onboarding, the account owner must
configure a production SMTP provider in Supabase and a protected server-only key
in Vercel; never place that secret in frontend configuration or Git.

The app truthfully preserves pending invitations when delivery is unavailable.
It does not silently create an account by an unrelated OTP fallback or claim an
email was delivered after an SMTP error. Delivery requires an exact pending
invitation, verified authorized sender, expiry/revocation checks and a cooldown.

Supabase Site URL was corrected from localhost:3000 to the existing public app.
The four exact redirect URLs are the public root and `?auth=signup`,
`?auth=invite`, `?auth=recovery` on https://sparta-field-u2pe.vercel.app/.
