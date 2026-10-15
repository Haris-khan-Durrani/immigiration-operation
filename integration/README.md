# Contract Manager Integration Hub (current protocol)

1. Deploy Operations at a public HTTPS address.
2. In Operations Settings > Connect Contract Manager save the Operations URL, source GHL location ID from Contract Manager and a random shared key (32-256 characters). The Contract Manager URL is optional. Set the intake activation date separately.
3. In Contract Manager Integration Hub set Operations Webhook Destination URL to `https://YOUR-OPERATIONS-DOMAIN/api/integrations/contracts/events`; paste the identical key into HMAC-SHA256 Signing Secret. Never include the key in the URL.
4. Click Share with Operations on a completed dossier containing signed contract and client summary PDF URLs. Open New clients in Operations and confirm receipt. Receipt count/last received in Settings track real intake; a ping does not increment them.
5. Agent chooses a published category and initiates the file, creating the client account/checklist and queuing login email. Enable SMTP or GHL email delivery for actual delivery.

## Signature and payload

`X-Webhook-Signature` is a 64-character hexadecimal HMAC-SHA256 digest of the exact raw JSON request body using the shared key. No prefix and no external timestamp header. If `X-Webhook-Event` is present it must equal the JSON event. The supported dossier event is `client_dossier.shared_with_operations` with eventId, timestamp, locationId, handover.action=OPERATIONS_HANDOFF, client, contract and documents as documented by Contract Manager.

Contract state must be COMPLETED, the source location must match Settings, and event timestamp must be on/after activation and not in the future. Delayed retries are supported; stable event IDs and location-scoped contract IDs prevent duplicate intake. Raw payload is preserved. Missing/unsafe document links and invalid required fields are rejected. Policy exclusions return skipped:true with a reason; correct the configuration and use a new eventId to reconsider an excluded event.

The dossier payload has no opportunity ID, pipeline ID or first-time-client marker. An internal location-scoped contract identity is used for duplicate tracking; no real CRM opportunity ID is inferred. Pipeline restrictions apply only to the legacy protocol. Sales explicitly sharing a completed dossier authorizes intake; first-time-client classification cannot be established from this payload.

Signed `ping`, `webhook.ping` and `test.ping` events return test:true and create no client. Other event names return a validation error. The actual Contract Manager Test Ping format is not supplied; if different, use a shared completed dossier for end-to-end verification and supply its ping payload for adaptation.

Source PDF/ZIP/attachment URLs are HTTPS links visible to staff in the intake and active file Information tab. Operations does not fetch those remote files or automatically count them as accepted checklist documents. The original signed contract digest and handover metadata remain in the stored dossier.

## Legacy summary sender

# Legacy handoff adapter

The Operations receiver and sender adapter are implemented. A source hook matching the actual Contract Manager backend is prepared in draft PR #1: https://github.com/Haris-khan-Durrani/contract-manager/pull/1. It is not merged/deployed. Its source files are also available under integration/contract-manager/. Configure it as follows.

1. Set CONTRACT_WEBHOOK_SECRET in Operations and OPERATIONS_WEBHOOK_SECRET in Contract Manager to the same random secret. Keep it server-side.
2. In Operations Settings set the activation date and approved sales pipeline IDs. The category and owner are chosen later by the agent.
3. After reviewing and deploying the source PR, set OPERATIONS_HANDOFF_ENABLED=true, OPERATIONS_APP_URL and OPERATIONS_ACTIVATION_DATE in Contract Manager. Its completed-summary route and worker already include the durable outbox hook. Do not backfill historical summaries.
4. The source worker signs/retries events with stable event IDs. See contract-manager/OPERATIONS_HANDOFF.md for source eligibility gates and configuration. The standalone contract-manager-sender.js adapter remains available for other source systems.

Example event payload:

```json
{
  "eventId": "a-stable-outbox-event-id",
  "contractId": "contract-123",
  "opportunityId": "ghl-opportunity-id",
  "contactId": "ghl-operations-location-contact-id",
  "pipelineId": "approved-sales-pipeline-id",
  "clientName": "Client name",
  "clientEmail": "client@example.com",
  "contractStatus": "COMPLETED",
  "summaryStatus": "COMPLETED",
  "isNewClient": true,
  "procedureEligible": true,
  "completedAt": "2026-10-14T10:00:00.000Z",
  "summary": {"service": "Example category"},
  "contractUrl": "https://your-contract-manager.example/contracts/123/pdf",
  "applicants": [{"name": "Primary applicant"}]
}
```

POST /api/integrations/contracts/events requires X-Contract-Timestamp (Unix seconds) and X-Contract-Signature (sha256= followed by the hex HMAC-SHA256 of timestamp + '.' + the exact JSON bytes). Requests expire after five minutes. Regenerate the signature for retries, retaining the same eventId. The adapter does this automatically.

The receiver applies eligibility rules independently, keeps a handoff-event ledger, checks contract and opportunity duplicates, and creates a pending intake entry only. No case, category assignment, client account or email is created until the agent explicitly initiates the file. At initiation, the case/checklist and client account are created transactionally and login details are queued. Repeated events return the original result. Skipped events include their reason. Corrected eligibility requires a new eventId; it still cannot duplicate a contract/opportunity.

If Operations uses a different GHL subaccount, contactId must identify the contact in the Operations location. Map/create that contact in the source integration first; email delivery checks location ownership. No historical import or source contact remapping is performed automatically.
