# Completed Client Summary to Operations intake

This integration sends qualifying completed summaries into Operations **New clients**. It does not assign a category, initiate a file, create a client account, or send client login details. An Operations agent explicitly chooses the category and initiates the file afterward.

Configure these server environment variables and restart Contract Manager:

```
OPERATIONS_HANDOFF_ENABLED=true
OPERATIONS_APP_URL=https://your-operations-app.example
OPERATIONS_WEBHOOK_SECRET=<same value as Operations CONTRACT_WEBHOOK_SECRET>
OPERATIONS_ACTIVATION_DATE=2026-10-14
```

Use MySQL for this handoff. The service creates operations_summary_outbox at startup when enabled. Summary completion and outbox insertion commit together. Delivery runs every minute with HMAC signatures, stable event IDs and retry/backoff. Pipeline identity is resolved through the existing location-scoped GHL service. Failed records remain in the outbox with their reason; skipped receiver results are retained as SKIPPED.

Source gates: signed/completed contract, source contract created on/after activation, opportunity present, first completed summary transition, and no earlier signed/completed contract for the same contact. Existing historical summaries are not scanned or backfilled. Operations also independently validates the activation date, approved pipelines and new-client/procedure flags.

If your new-client eligibility policy differs, update these explicit source gates before enabling. For a separate Operations GHL location, implement source-to-Operations contact mapping first; otherwise use the same location/contact identity.

In Operations configure the activation date and approved pipelines, CRM location/token, APP_URL and EMAIL_DELIVERY_ENABLED. The agent's initiation transaction creates the case checklist and client account and queues the email containing the portal URL, login email and temporary password. Client password changes are required before document access.

Validation: factory unit tests in Operations cover source gating and exact HMAC payload signing. Operations MySQL/browser tests cover receipt without case/account/email creation, explicit initiation and category selection, credentials queueing/password change, document reviews, duplicate protection and access restrictions. Full Contract Manager CI and a live GHL/Operations deployment still need to run before merging/deployment.
