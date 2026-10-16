# Implemented workflow and release status

## Available in the application

- Staff email/password login, client temporary-password login and required password change, expiring HTTP-only sessions and logout.
- Admin user creation, account edits, role/team changes, deactivation, password reset, self password change and session revocation.
- Teams and backend access policies: administrators across all cases; managers within their team; agents on assigned cases; clients on their own files only.
- Parent/subcategories, editable field assignments, client guides, draft/published versions and version snapshots.
- Text, textarea, email, number, date, dropdown, checkbox and document fields; conditional visibility; numeric limits; future-date validation; required flags; HTTPS samples; format/size limits; multiple document slots; repeated applicants.
- Contract Manager intake, explicit agent-initiated file/category selection, profile, imported Client Summary, signed-contract link, assignee/deadline, category snapshot and explicit template migration with retained history.
- Per-client extra requests and reasoned waivers without modifying global templates.
- Client forms, private encrypted PDF/JPG/PNG uploads, immutable document versions, authenticated previews/downloads and download audit events.
- Accept/reject with rejection reason, re-upload, client-visible upload/approval/rejection timestamps, latest-version review enforcement and document inbox.
- Completion based on valid mandatory fields and accepted latest document versions; readiness notifications; manager approval; submission/completion/cancellation/reopening. Changes to approved form information require approval again.
- Case tasks, deadlines, completion/reopening, internal notes and separate client-visible portal messages.
- CRM email composition, encrypted outbox, delivery status, explicit failed/uncertain-send retries and GHL conversation retrieval.
- Client login-details, extra-requirement, document-review and daily overdue-collection email queues; staff/client in-app notifications; task and case overdue reminders.
- Role-scoped dashboards, stage counts, pending reviews, workload/completion/overdue reports and audit logs.
- Admin CRM location/token settings, token encryption, connection test, onboarding policy and optional staff-triggered GHL Media copies after location privacy verification.
- Signed Contract Manager receiver, eligibility gates, stable-event deduplication, contract/opportunity duplicate checks, sender hook and pending intake creation; explicit agent initiation creates the file and queues client credentials.
- Recurring server maintenance, manual queue processing, session cleanup, encrypted backups and restore into an empty database.
- Docker/MySQL deployment files and setup/integration documentation.

## Verified here

JavaScript syntax checks and security/domain unit tests pass. A separate temporary MySQL database tested summary receipt without file/account/email creation, explicit agent initiation, generated client credentials and first-login password change, uploads, rejection/re-upload, approval, manager processing, task access, cross-client/team denial, internal-note privacy, published-template isolation, signed/new-client-only/idempotent handoff, user deactivation, encrypted backup and restore. Headless Microsoft Edge tested category/field publishing, completed-summary intake, explicit file initiation/category selection, client sign-in/password change, document previews, mobile overflow and browser JavaScript errors. Test databases and document fixtures are removed afterward. No live CRM emails were sent during testing.

## Required before live use

1. Create your first administrator with `npm run admin:create`, then create teams and staff.
2. Configure actual GHL location/token, contact identities, email sender and required API scopes. Live CRM email, inbox retrieval and media-copy behavior need testing against your subaccount.
3. Review and deploy the Contract Manager source hook in draft PR #1: https://github.com/Haris-khan-Durrani/contract-manager/pull/1. That source change is not merged or live yet.
4. Set APP_URL and CONTRACT_WEBHOOK_SECRET in Operations. Set the matching OPERATIONS_WEBHOOK_SECRET, OPERATIONS_APP_URL, OPERATIONS_HANDOFF_ENABLED and OPERATIONS_ACTIVATION_DATE in Contract Manager. Configure intake rules in Operations Settings and enable EMAIL_DELIVERY_ENABLED when ready to deliver client credentials.
5. Deploy behind HTTPS, set NODE_ENV=production, configure persistent private file/MySQL volumes, and schedule off-host encrypted backups. Docker/TLS deployment has not been run here.

Private local storage is the document source of truth. GHL Media copies are optional; a failed copy does not discard the private original. Category fields belong directly to the selected category; parent fields do not inherit. Multiple document slots are individually reviewed. Optional CRM copies support compression and a selected Media parent folder while retaining originals. Password recovery is administrator-managed. Production operations and external service wiring still require the steps above; the project is not already deployed or connected to the external Contract Manager.

- Client study workspace with right-side portal conversations, private notes and CRM/email controls; responsive layout.
- Initiated intake entries have an Open file action; source dossiers can be reviewed before initiation.
- Audited pre-initiation email correction for staff/client email conflicts, without changing staff identities.
- Category name/parent editing, cycle prevention and confirmed deletion of unused categories; assigned categories/subcategories protect deletion.

- Chronological conversation bubbles with author/time, separate CRM email history and private team notes.
- Staff-managed operational status labels, assigned per file without changing approval stages.
- Configurable missing/rejected required-document reminders at initiation and per-file settings, with queue deduplication and send-time rechecks.
- Multiple expiry tracking items with lead-time/repeat/final alerts, client emails/portal notifications and owner notifications.
- Backup/restore includes statuses, expiry records and per-file reminder schedules; calendar dates retain date-only values.

- Status colour picker and coloured status chips.
- Category field sorting, text-only editing with immutable existing types, group titles, full/half widths and client form preview.
- Phone, HTTPS URL and radio answer fields; heading, paragraph and divider layout blocks.
- Scoped read-only client view audited to Operations, without client session/login events or exposure of private staff data.
