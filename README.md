# Operations application

A client operations workspace with staff login, category-based checklists, client uploads, document review, tasks, messaging, SMTP/GoHighLevel email and Contract Manager dossier handoffs. Uses **Node.js 24 and MySQL 8**; the Docker configuration uses Node.js 24 and MySQL 8.4.

This guide takes a new installation from downloading the code to serving it at `https://operations.example.com`. Replace all example domains, IPs, emails and passwords. GitHub stores the source code; pushing to GitHub does **not** deploy it.

## Contents

1. [Workflow](#workflow)
2. [Requirements](#requirements)
3. [Live server installation with Docker](#live-server-installation-with-docker)
4. [Domain and HTTPS](#domain-and-https)
5. [First administrator and workspace setup](#first-administrator-and-workspace-setup)
6. [Connect Contract Manager](#connect-contract-manager)
7. [Email and CRM](#email-and-crm)
8. [Environment reference](#environment-reference)
9. [Native installation without Docker](#native-installation-without-docker)
10. [Manual Linux production service](#manual-linux-production-service)
11. [Administration](#administration)
12. [Backups and recovery](#backups-and-recovery)
13. [Updates and rollback](#updates-and-rollback)
14. [Tests](#tests)
15. [Troubleshooting](#troubleshooting)
16. [Deployment limits](#deployment-limits)

## Workflow

1. Sales clicks **Share with Operations** on a completed dossier in Contract Manager.
2. The signed webhook creates an entry in **New clients**, without creating an account or sending credentials.
3. An agent reviews the source details, chooses a published category and initiates the file.
4. The application creates the checklist/client account and queues the portal URL, email and temporary password for delivery.
5. The client signs in, changes the temporary password and uploads requested documents.
6. Staff review versions, request corrections, manage tasks/messages and progress the file through manager approval/submission/completion.

Express serves the frontend and API together. No separate frontend build or Redis is needed. MySQL holds records; document originals and email payloads are encrypted. See [FEATURES.md](FEATURES.md).

## Requirements

For the main deployment path:

- Ubuntu server with SSH and sudo access; Ubuntu 24.04 LTS is a suitable baseline.
- A starting allocation of 2 CPU cores, 2 GB RAM and enough disk for documents/backups. This is a planning baseline, not a tested capacity guarantee.
- A domain/subdomain pointing to your server, such as `operations.example.com`.
- Docker Engine, Compose plugin, Git and an HTTPS reverse proxy such as Caddy.
- SMTP or GoHighLevel email capability for client login messages.
- Contract Manager Integration Hub access and its source GHL location ID for automatic intake.
- Outbound network access to your email/CRM services and certificate services.

Only SSH and HTTP/HTTPS need public access. Compose keeps MySQL internal and binds app port 3000 to host loopback. Static-only hosting cannot run this app. Shared hosting must support persistent Node.js processes, MySQL and private file storage; otherwise use a VPS/container host.

## Live server installation with Docker

Run these commands **on your server over SSH**.

### 1. Install prerequisites

```bash
ssh YOUR_SSH_USER@YOUR_SERVER_IP
sudo apt update
sudo apt install -y git ca-certificates curl
```

Install Docker Engine and the Compose plugin using the [official Ubuntu guide](https://docs.docker.com/engine/install/ubuntu/). Follow its repository setup; avoid mixing conflicting Docker packages.

```bash
sudo docker --version
sudo docker compose version
sudo systemctl enable --now docker
```

This guide uses `sudo docker`, so changing Docker group membership is unnecessary.

### 2. Download the project

```bash
sudo mkdir -p /srv/operations
sudo chown "$USER":"$(id -gn)" /srv/operations
git clone https://github.com/Haris-khan-Durrani/immigiration-operation.git /srv/operations
cd /srv/operations
cp .env.example .env
chmod 600 .env
```

For a private repository, authenticate with an account that has access. Do not embed a token in the clone URL or commit it.

### 3. Generate secrets

```bash
openssl rand -hex 32
```

Run it three separate times: for the encryption key, application database password and MySQL root password. Store the encryption key securely, separately from backups.

> Never replace `ENCRYPTION_KEY` on an existing installation. A different key cannot decrypt existing documents, stored CRM/SMTP credentials, queued emails or backups. Generate a new key only for a new empty installation.

### 4. Configure .env

```bash
nano .env
```

Production template (replace every password/key placeholder):

```dotenv
NODE_ENV=production
APP_URL=https://operations.example.com
HOST=127.0.0.1
PORT=3000
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=operations
MYSQL_USER=operations
MYSQL_PASSWORD=REPLACE_WITH_RANDOM_DATABASE_PASSWORD
MYSQL_ROOT_PASSWORD=REPLACE_WITH_DIFFERENT_RANDOM_ROOT_PASSWORD
ENCRYPTION_KEY=REPLACE_WITH_EXACTLY_64_HEXADECIMAL_CHARACTERS
UPLOAD_DIR=private-uploads
INITIAL_ADMIN_NAME=Administrator
INITIAL_ADMIN_EMAIL=
INITIAL_ADMIN_PASSWORD=
CONTRACT_WEBHOOK_SECRET=
EMAIL_DELIVERY_ENABLED=false
```

Compose overrides the database hostname to `mysql`, database port to 3306, app bind address to `0.0.0.0`, app port to 3000 and upload path to `/app/private-uploads` **inside containers**. It uses the same database/user/password values to initialize MySQL and connect the app. Do not set `MYSQL_USER=root`.

Set `APP_URL` to the final public HTTPS portal before creating client files. `NODE_ENV=production` enables Secure session cookies; browser login must use HTTPS. Leave initial admin email/password blank for interactive creation. Generate the webhook key later in Settings. Outgoing emails start paused.

### 5. Build and start

```bash
sudo docker compose config --quiet
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=100 app
curl -I http://127.0.0.1:3000/
```

The image installs production dependencies and prepares PDF preview assets. Startup runs migrations, then starts Express. MySQL's first initialization may take time; Compose waits for its health check.

Expected app output:

```text
MySQL schema initialized.
Operations application: http://localhost:3000
```

HTTP 200 confirms the page is served; verify database login/email/intake separately below.

**Docker command distinction:** use `docker compose exec app node ...`. Containers receive variables from Compose and do not contain `.env`. The `npm start`, migration, admin and backup npm scripts use `--env-file=.env` and are intended for the native installation.

## Domain and HTTPS

### 1. Configure DNS and ports

Create an A record for the hostname pointing to your server IPv4. Only add AAAA if IPv6 works. Wait for DNS to resolve correctly. Allow TCP 80/443 in your cloud firewall; preserve SSH access.

For a fresh UFW installation with the standard SSH profile:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

If SSH uses another port, allow that port before enabling UFW. Do not publicly expose 3000 or 3306.

### 2. Configure Caddy

Install Caddy using its [official Debian/Ubuntu instructions](https://caddyserver.com/docs/install). Its [HTTPS quick-start](https://caddyserver.com/docs/quick-starts/https) explains domain-based certificate management and redirects.

```bash
sudo nano /etc/caddy/Caddyfile
```

For a server dedicated to this app:

```caddyfile
operations.example.com {
    reverse_proxy 127.0.0.1:3000 {
        header_up -X-Forwarded-For
    }
}
```

Replace the hostname. Preserve other site blocks on a shared server. If another proxy already occupies ports 80/443, configure that proxy rather than starting a conflicting service. Proxy the entire hostname including `/api`; this frontend expects installation at `/`, not a subpath such as `/operations/`.

The header removal matches the current application, which does not trust forwarded client IPs. Rate limits are therefore shared behind this proxy; see [deployment limits](#deployment-limits).

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
curl -I https://operations.example.com/
```

Open the HTTPS address in a browser. DNS and public ports must work before automatic certificate issuance succeeds.

## First administrator and workspace setup

```bash
cd /srv/operations
sudo docker compose exec app node server/create-admin.js
```

Enter your name, email and a **12-128 character** password. No default credentials exist. Once an administrator exists, use **Team** to add further accounts; the bootstrap command refuses another initial administrator.

For noninteractive setup, temporarily set `INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD` in `.env`, recreate the app, run the creation command, remove the initial password and recreate it again:

```bash
sudo docker compose up -d --force-recreate app
```

A simple restart does not reload changed Compose environment variables.

After signing in:

1. Create teams and staff accounts in **Team**.
2. Create parent/subcategories and field/document requirements in **Categories**, then publish usable categories.
3. Configure intake and email in **Settings**.
4. Leave documents in private storage. Optional CRM copies require confirmed GHL media privacy.

## Connect Contract Manager

The existing **Webhooks & Operations Integration Hub** is supported; it does not require the older draft source adapter PR.

1. Open Operations at its actual HTTPS hostname and go to **Settings > Connect your client handoffs**.
2. Enter the sender's GHL source location ID and activation date. This can differ from the location used for Operations CRM messaging.
3. Generate/copy a shared key and **Save application linking**. Generating alone does not save it.
4. Click **Copy URL**. The panel supplies your receiving endpoint automatically:

   ```text
   https://operations.example.com/api/integrations/contracts/events
   ```

5. In Contract Manager paste that endpoint into **Operations Webhook Destination URL**, and the identical key into **HMAC-SHA256 Signing Secret**. Save there too. Never append the key to the URL.
6. Click **Share with Operations** on a completed dossier containing signed-contract and client-summary PDF links.
7. Check **New clients** and Settings activity in Operations. Initiate a file with a published category, then verify the client email journey.

| Status | Meaning |
| --- | --- |
| Setup needed | Required local values are missing. |
| Ready to receive | Local setup is saved; an incoming delivery is still needed to prove reachability. |
| Receiving dossiers | Intake has been recorded; history is not a continuous uptime monitor. |

The Hub event is `client_dossier.shared_with_operations`. `X-Webhook-Signature` is the hex HMAC-SHA256 digest of the exact raw JSON bytes. Intake checks source location, activation date, completed state and required PDF links. The documented payload has no pipeline/opportunity/new-client flag; explicit sharing authorizes dossier intake. Older summary senders retain their legacy policy.

Repeated event IDs and location-scoped contract IDs do not duplicate intake. Policy exclusions/signature failures appear in activity. Signed ping event names supported: `ping`, `webhook.ping`, `test.ping`. If Test Ping sends another format, inspect the response and use a real shared dossier to verify delivery.

Original dossier details are retained. PDF/ZIP/attachment URLs remain remote staff links; they are not downloaded automatically or counted as accepted checklist uploads. See [integration/README.md](integration/README.md) for protocol details.

Rotate keys in both apps together. Normal settings reads do not return secrets; explicitly showing/copying an existing key uses an administrator-only audited endpoint. A saved key takes precedence over the environment fallback.

## Email and CRM

### SMTP

1. In **Settings > Email delivery** choose SMTP server.
2. Enter host, port/security (usually 587 STARTTLS or 465 SSL/TLS), authentication, username/password, sender name/email and optional reply-to. Use an app password if required by your provider. No encryption is for an explicitly appropriate private relay only.
3. Save, test connection, then send a test email to an inbox you can inspect. Authentication success does not prove inbox delivery or sender authorization.
4. Enable outgoing email and save again.

Blank passwords preserve the existing password for the same SMTP account. Changing server/account/security may require a new password. Credentials are encrypted. SMTP does not require a GHL contact. Configure SPF/DKIM/DMARC through your email provider as appropriate.

### GoHighLevel

In **CRM connection** save the Operations location ID and private token. Test location access. The token also needs the messaging/optional media permissions required by the features you use; the test checks location access only.

Choose GoHighLevel as email provider for CRM messaging. If source/messaging locations differ, contact IDs must identify contacts in the Operations messaging location.

### Queue

The running app checks maintenance about once per minute. **Process email queue** runs a pass immediately. No separate cron worker is needed for normal email delivery. Paused delivery leaves messages queued. For uncertain delivery, check provider records before retrying to avoid duplicates. SMTP acceptance is not guaranteed inbox delivery.

## Environment reference

`.env` belongs at the project root and is ignored by Git. Never put real secrets in `.env.example`.

| Variable | Purpose |
| --- | --- |
| NODE_ENV | `production` on live HTTPS for Secure cookies; `development` for local HTTP. |
| APP_URL | Public portal URL for generated emails unless a saved Operations URL overrides it. Set before initiating files. |
| HOST / PORT | Native listener, normally 127.0.0.1:3000. Compose overrides inside its container. |
| MYSQL_HOST / MYSQL_PORT | Database endpoint. Compose overrides to mysql:3306. |
| MYSQL_DATABASE / MYSQL_USER / MYSQL_PASSWORD | Existing database/account for native; initialized on first Docker database startup. |
| MYSQL_ROOT_PASSWORD | Required by Compose MySQL, not used by the application connection. |
| ENCRYPTION_KEY | Required 64 hexadecimal characters. Preserve for existing data/restores. |
| UPLOAD_DIR | Private documents. Native default private-uploads; container path /app/private-uploads. |
| INITIAL_ADMIN_NAME | Initial name default. |
| INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD | Optional temporary noninteractive bootstrap inputs; remove password afterward. |
| CONTRACT_WEBHOOK_SECRET | Optional shared-key fallback. Settings takes precedence. Generate separately from the encryption key. |
| EMAIL_DELIVERY_ENABLED | Initial fallback only; saved email configuration takes precedence. |

MySQL initialization variables only initialize an empty volume. Changing a password in `.env` does not alter an existing MySQL account. Change the database account and application configuration together; do not delete volumes to reset credentials.

## Native installation without Docker

For development or a manually managed host, install Node.js 24 and MySQL 8 from [Node.js](https://nodejs.org/en/download) and the [MySQL installation guide](https://dev.mysql.com/doc/refman/8.4/en/installing.html).

### 1. Create a database/account

Run in MySQL as an administrator:

```sql
CREATE DATABASE operations CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'operations'@'localhost' IDENTIFIED BY 'REPLACE_WITH_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON operations.* TO 'operations'@'localhost';
```

Choose the account host matching your installation. Migrations create/upgrade tables, not the database or account. Schema privileges are required; runtime/migration accounts are not separated by the current application.

### 2. Download/configure

```bash
git clone https://github.com/Haris-khan-Durrani/immigiration-operation.git
cd immigiration-operation
npm ci
```

Linux/macOS:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env` with MySQL credentials. Local HTTP uses `NODE_ENV=development` and `APP_URL=http://localhost:3000`. Generate an encryption key and copy its output into ENCRYPTION_KEY:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Leave initial admin email/password blank for prompts. Do not skip npm install scripts: postinstall generates PDF preview assets. Native image-processing dependencies need a supported platform/architecture.

### 3. Initialize/run

```bash
npm run db:migrate
npm run admin:create
npm start
```

Open http://localhost:3000. Ctrl+C stops the process. A live Contract Manager cannot reach localhost.

## Manual Linux production service

This is an alternative to Docker. Complete native installation in `/srv/operations`, set production/HTTPS values, migrate and create the administrator first. Do not run Docker/native copies on the same port.

```bash
sudo useradd --system --home /srv/operations --shell /usr/sbin/nologin operations
sudo chown -R operations:operations /srv/operations
sudo chmod 600 /srv/operations/.env
sudo -u operations mkdir -p /srv/operations/private-uploads /srv/operations/backups
command -v node
sudo nano /etc/systemd/system/operations.service
```

Use the absolute Node.js 24 path from `command -v node` in ExecStart. A system-wide install is easier than a shell-only version manager for systemd.

```ini
[Unit]
Description=Operations application
After=network.target

[Service]
Type=simple
User=operations
Group=operations
WorkingDirectory=/srv/operations
ExecStart=/usr/bin/node --env-file=/srv/operations/.env /srv/operations/server/index.js
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now operations
sudo systemctl status operations
sudo journalctl -u operations -n 100 --no-pager
```

Use the Caddy HTTPS setup above. Ensure MySQL is available before startup. Native migrations are manual before each new release. After changing `.env`, restart the service.

## Administration

Run Docker commands from `/srv/operations`:

| Task | Command |
| --- | --- |
| Status | `sudo docker compose ps` |
| Recent logs | `sudo docker compose logs --tail=100 app` |
| Follow logs | `sudo docker compose logs -f app` |
| Database logs | `sudo docker compose logs --tail=100 mysql` |
| Restart, same environment | `sudo docker compose restart app` |
| Apply changed .env | `sudo docker compose up -d --force-recreate app` |
| Stop app only | `sudo docker compose stop app` |
| Start stopped app | `sudo docker compose start app` |
| Maintenance pass | `sudo docker compose exec app node server/jobs.js` |
| Stop containers, retain volumes | `sudo docker compose down` |

Do not add `-v` to `docker compose down` on data you need: it removes named volumes. Changing the Compose project name creates separate volumes and can make existing data appear missing.

Volumes mysql-data, document-data and backup-data retain database/documents/backups; actual names include a project prefix. `.env` is a separate host file. Git ignores local secrets, private data, dependencies and generated/test assets.

## Backups and recovery

### Coordinated Docker backup

Backups contain encrypted application tables and referenced encrypted document originals. They do not contain `.env`, the encryption key, TLS/server configuration. Preserve those separately.

Stop the app to pause writes; keep MySQL running. Incoming webhook requests temporarily fail, so the sender must retry according to its behavior.

```bash
cd /srv/operations
sudo docker compose stop app
sudo docker compose run --rm --no-deps app node scripts/backup.js
sudo docker compose start app
```

The script prints a directory such as `/app/backups/2026-10-15T12-00-00-000Z`. Export your actual timestamp:

```bash
sudo mkdir -p /srv/operations-backups
sudo docker compose cp app:/app/backups/2026-10-15T12-00-00-000Z /srv/operations-backups/
sudo chmod -R go-rwx /srv/operations-backups
```

Keep the whole directory (`database.enc` and `files/`) off-server, with the key separately stored. A backup on the same failed disk is insufficient. Schedule maintenance-window backups and rehearse restoring on an isolated host. If backup fails, resolve the error and restart the app; do not delete document originals to bypass errors.

Native equivalent:

```bash
sudo systemctl stop operations
cd /srv/operations
sudo -u operations npm run backup
sudo systemctl start operations
```

### Restore safely

Restore requires a freshly migrated **empty** database and empty private document storage. It refuses to overwrite populated application tables. Do not restore into the live database.

For Docker recovery:

1. Clone into a separate directory, such as `/srv/operations-recovery`.
2. Create its own `.env` with the **original ENCRYPTION_KEY**, new database credentials and intended portal URL. Keep live traffic away until verified.
3. Put the complete backup under `/srv/operations-backups/TIMESTAMP` on the recovery host.
4. Use a separate Compose project for independent network/volumes:

```bash
cd /srv/operations-recovery
sudo docker compose -p operations-recovery build app
sudo docker compose -p operations-recovery up -d mysql
sudo docker compose -p operations-recovery run --rm app node server/migrate.js
sudo docker compose -p operations-recovery run --rm --no-deps -v /srv/operations-backups:/restore:ro app node scripts/restore.js /restore/TIMESTAMP
```

Wait for MySQL health before migration. Restore runs as the container's unprivileged node user. Grant that user narrowly scoped read/traverse permissions on the backup via a group/ACL if necessary; keep backups inaccessible to unrelated users.

After successful restore, review configuration and start recovery only when its port will not conflict with the original app. Stop the original or change the recovery port mapping if both share one server:

```bash
sudo docker compose -p operations-recovery up -d app
```

Native restore, with a fresh database and original key:

```bash
npm run db:migrate
npm run restore -- /absolute/path/to/backup/TIMESTAMP
```

Restore revokes sessions and marks queued/sending email UNKNOWN. Check provider delivery before retrying. Saved email/CRM credentials/settings are restored. Verify login, categories, a known client file/document before moving proxy/DNS traffic to recovery.

## Updates and rollback

### Docker update

Take a coordinated backup first and record the current Git commit. Preserve local changes and `.env`; do not regenerate the encryption key.

```bash
cd /srv/operations
git rev-parse HEAD
sudo docker compose stop app
git pull --ff-only origin main
sudo docker compose up -d --build app
sudo docker compose logs --tail=100 app
```

Startup runs migrations. Verify HTTPS login, a known file/document, Settings activity and email queue state. Do not initiate real client files merely as deployment test data. If pull/build fails, inspect the error before continuing; the app may remain stopped.

### Native update

After backup:

```bash
sudo systemctl stop operations
cd /srv/operations
sudo -u operations git pull --ff-only origin main
sudo -u operations npm ci --omit=dev
sudo -u operations npm run db:migrate
sudo systemctl start operations
sudo journalctl -u operations -n 100 --no-pager
```

### Rollback

Checking out an earlier commit restores code only, not database state. If the older version is schema-compatible, check out your recorded commit and rebuild/restart. Otherwise restore the pre-update backup into a fresh isolated environment with the original key, verify and switch traffic. No automatic down-migration command exists.

## Tests

In a development checkout with dev dependencies:

```bash
npm ci
npm run check
npm test
npm run test:integration
npm run test:e2e
```

`npm test` runs unit tests; the MySQL journey is skipped unless the integration runner enables it. Integration scripts load `.env`, create/drop uniquely named test databases and create/remove temporary upload directories. Use a separate test account with database creation/drop privileges; an account limited to `operations.*` cannot run them. Run away from production.

The browser suite launches Microsoft Edge through Playwright (`channel: msedge`); Edge must be available on the test machine. SMTP tests use a local relay, not external recipients. Screenshots go to ignored `artifacts/`.

## Troubleshooting

| Problem | Check / resolution |
| --- | --- |
| Missing Compose password | Set MYSQL_PASSWORD and MYSQL_ROOT_PASSWORD. Use `docker compose config --quiet`; full resolved config can print secrets. |
| MySQL access denied after editing .env | Existing database passwords do not change with initialization variables. Update the actual MySQL user and app config together, preserving the volume. |
| Database connection refused | Check MySQL health/logs. Docker uses service hostname mysql; native requires the actual endpoint and existing database/account. |
| Encryption key error | Supply 64 hex characters. Existing data needs its original key, not a replacement. |
| HTTPS certificate failure | Check DNS, incorrect AAAA records, public 80/443, conflicting servers and `journalctl -u caddy`. |
| Login immediately returns to sign-in | Production Secure cookies require HTTPS. Use development mode only for local HTTP. |
| 502 Bad Gateway | Check app logs/status and `curl -I http://127.0.0.1:3000/`. Proxy the host loopback port. |
| Webhook signature rejected | Match keys in both apps. The Hub signs the exact raw JSON with plain hex X-Webhook-Signature. Reformatting after signing breaks verification. |
| Handoff skipped | Inspect activity reason: source location, activation date, contract state, required PDFs. Excluded event IDs are remembered; after correcting policy use a new eventId to reconsider. Duplicate contracts remain excluded. |
| No New clients entry | Click Share with Operations, verify destination/response and server reachability. Live servers cannot reach your localhost. |
| No client login email | Receipt alone does not send credentials. An agent must select a published category and initiate; enable email and inspect queue/provider status. |
| SMTP failure | Check port/security, authentication/app password, sender authorization and outbound firewall. Save before testing. |
| Client emails point to localhost | Correct APP_URL and save linking from the real HTTPS site. Existing queued messages are not automatically rewritten. |
| Missing PDF preview | Run npm ci with install scripts, or rebuild Docker; public/vendor is generated and not committed. |
| Upload rejected | Global limit is 10 MB; category limits/formats can be stricter. Remote source links do not count as checklist uploads. |
| Permission denied on private files | Check volume/path access for container node or native operations user. Do not make private directories publicly writable. |
| Outdated page/API | Ctrl+F5; rebuild/recreate the app after code changes, or restart the native service. |
| Too many requests | API limit is 180 requests/minute; login has a tighter limit. Proxy users currently share request budgets. |

## Deployment limits

- This guide targets one application instance. Multiple app/maintenance workers need coordinated jobs and shared storage before use.
- Express currently has no trusted-proxy configuration. The example removes X-Forwarded-For to avoid rate-limit proxy validation errors, so users behind the proxy share its request budget. Configure narrowly trusted proxy/IP handling before relying on per-client limits at larger scale.
- MySQL is required. SQLite/PostgreSQL are not drop-in alternatives.
- Keep database/document volumes, `.env` and the encryption key across container replacements. GitHub is not a data backup.
- Published categories are versioned; existing files retain their assigned checklist snapshot.
- No clients or default admin credentials are seeded. Migrations create schema/default workflow settings.
- The deployment commands are based on the repository and linked official documentation. Application unit/MySQL/browser checks have run locally; an actual VPS, DNS/certificate issuance and your real SMTP/CRM services still need verification on the target server.
