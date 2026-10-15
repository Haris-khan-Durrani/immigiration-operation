# Operations application

An Express and MySQL application for Operations teams and client document collection.

## Start locally

Requires Node.js and MySQL 8. Copy .env.example to .env for a new installation, then configure the database and encryption key. Preserve an existing .env and encryption key.

```powershell
npm install
npm run db:migrate
npm run admin:create
npm start
```

Open http://localhost:3000. The first administrator is created interactively. Staff accounts are managed in Team. For the full implemented feature inventory see FEATURES.md.

## Client workflow

Contract Manager sends completed, eligible new-client summaries into New clients. The receiver checks the activation date, approved pipeline IDs, signature and duplicate contract/opportunity IDs. Arrival creates an intake entry only.

An agent opens the intake, chooses a published category and initiates the file. This creates the checklist and client account, queues the portal login details and moves the file into Client files. Clients must change their temporary password at first login, then upload requested documents. Agents review versions, request corrections and manage tasks/messages; managers approve submission and completion.

## Link Contract Manager

Settings > Connect Contract Manager provides the webhook destination URL automatically from the current HTTPS application address (or a previously configured public address during local development). Copy it into Contract Manager. You do not need to enter either application URL in this panel. Save the source location ID, activation date and a shared key of 32-256 characters. The shared key is encrypted and is never returned by the settings API. A saved key overrides CONTRACT_WEBHOOK_SECRET; a saved Operations URL overrides APP_URL for newly generated login emails. Rotating a key requires setting the same value on Contract Manager.

Use the existing Contract Manager Integration Hub. In Operations Settings save the Contract Manager source GHL location ID, activation date and shared key. In Contract Manager set its Operations Webhook Destination URL to `https://YOUR-OPERATIONS-DOMAIN/api/integrations/contracts/events` and its HMAC-SHA256 Signing Secret to the same key. Click Share with Operations on a completed dossier to verify intake. No additional source PR is required for this documented Hub protocol.

The receiver supports `client_dossier.shared_with_operations`, verifies `X-Webhook-Signature` as a hex HMAC-SHA256 digest over the exact raw JSON bytes, and stores the original dossier plus normalized details. Its configured source location and activation date gate intake. The documented payload has no pipeline, opportunity or new-client marker; explicit sales sharing is the authorization for a dossier handoff. Document links remain remote links, not downloaded or marked as reviewed checklist uploads. They appear in the intake summary and staff Information tab after initiation.

For older integrations, the timestamp-signed legacy summary protocol is still supported with its pipeline and new-client rules. The earlier draft sender PR is an optional legacy adapter, not needed when using the Integration Hub. See integration/README.md for both protocols.

## CRM and email

Settings > CRM connection stores the GoHighLevel location ID and encrypted private token. If the apps use different GHL locations, the sender must map the contact to the Operations location for GHL messaging.

Settings > Email delivery supports GoHighLevel or SMTP. For SMTP enter host, port, security, authentication, sender and optional reply-to, save, test connection, then send a test email. Enable outgoing emails when ready. Blank passwords preserve the saved account password; changing the SMTP account requires a new password. SMTP works without a CRM contact.

Paused delivery keeps login emails queued. The maintenance worker runs every minute; Process email queue runs it immediately. Ambiguous deliveries require checking the provider before retrying to avoid duplicate emails.

## Data and storage

MySQL holds users, intake, files, category versions, tasks, audit history and encrypted email jobs. Document originals are encrypted in private storage, outside public assets. Preserve the encryption key with backups. CRM media copies are optional and require confirmed location privacy. Category edits use published versions; existing files retain their assigned checklist snapshot.

## Verification and backups

```powershell
npm run check
npm test
npm run test:integration
npm run test:e2e
npm run backup
```

Integration tests use isolated temporary MySQL databases; browser checks use Playwright with Microsoft Edge. SMTP tests use a local relay and send no external email. See package.json for restore and maintenance commands. Live deployment requires HTTPS, a reachable Operations server, persistent private document storage and securely managed environment credentials.

The connection panel provides setup progress, Generate/Show/Copy key controls, a copyable endpoint and receiver activity. Generating a replacement key does not save it until Save application linking. Viewing/copying an existing saved key uses an administrator-only audited endpoint. Ready to receive reports saved setup; delivery history reports actual received, excluded and rejected requests. Refresh status fetches current results.
