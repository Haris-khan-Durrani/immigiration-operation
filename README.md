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
10. [Live installation with PM2](#live-installation-with-pm2)
11. [Manual Linux production service](#manual-linux-production-service)
12. [Administration](#administration)
13. [Backups and recovery](#backups-and-recovery)
14. [Updates and rollback](#updates-and-rollback)
15. [Tests](#tests)
16. [Troubleshooting](#troubleshooting)
17. [Deployment limits](#deployment-limits)

## Workflow

1. Sales clicks **Share with Operations** on a completed dossier in Contract Manager.
2. The signed webhook creates an entry in **New clients**, without creating an account or sending credentials.
3. An agent reviews the source details, chooses a published category and initiates the file.
4. The application creates the checklist/client account and queues the portal URL, email and temporary password for delivery.
5. The client signs in, changes the temporary password and uploads requested documents.
6. Staff review versions, request corrections, manage tasks/messages and progress the file through manager approval/submission/completion.

Express serves the frontend and API together. No separate frontend build or Redis is needed. MySQL holds records; new document originals are stored in GoHighLevel Media, and email payloads are encrypted. See [FEATURES.md](FEATURES.md).

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

## Native Nginx reverse proxy

If Nginx and the native Node process run on the same server, use the Node loopback listener. For an installation with `PORT=3010`, add `TRUST_PROXY=loopback` to `.env`, restart Operations and use this location block in the domain's HTTPS virtual host:

```nginx
location ^~ / {
    client_max_body_size 12M;
    proxy_pass http://127.0.0.1:3010;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header Connection "";
    proxy_connect_timeout 60s;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
}
```

Match the upstream port to your `.env`; 3010 is an example for a shared server. Do not proxy to the public IP when Node listens only on 127.0.0.1. Overwrite forwarded headers rather than preserving an untrusted client chain. The loopback setting trusts only local peers; do not use unrestricted `true`. This mode is for a native local proxy, not automatically for Docker bridge addresses or a remote proxy.

Validate with `nginx -t` and reload Nginx only if it succeeds, or use the hosting panel's validation/reload action. Do not change unrelated domains. Details: [Express proxy trust](https://expressjs.com/en/guide/behind-proxies/).

For the existing Docker/Caddy example, keep `TRUST_PROXY=false` and the header-removal configuration. Direct requests with no reverse proxy also use false.

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
4. Configure the CRM token with medias.write permission for document storage. Optionally choose a GHL Media folder.

## Connect Contract Manager

The existing **Webhooks & Operations Integration Hub** is supported; it does not require the older draft source adapter PR.

1. Open Operations at its actual HTTPS hostname and go to **Settings > Connect your client handoffs**.
2. Enter the sender's GHL source location ID. This can differ from the location used for Operations CRM messaging.
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

The Hub event is `client_dossier.shared_with_operations`. `X-Webhook-Signature` is the hex HMAC-SHA256 digest of the exact raw JSON bytes. Intake checks source location, completed state and required PDF links. The documented payload has no pipeline/opportunity/new-client flag; explicit sharing authorizes dossier intake. Older summary senders retain their legacy policy.

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
| TRUST_PROXY | false by default; loopback for a native reverse proxy on the same host with overwritten forwarding headers. Unrestricted true is rejected. |
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

## Live installation with PM2

PM2 is an alternative to Docker or the manual application systemd service. It keeps the Node process running, restarts it after a crash and can restore it at server boot. You still need MySQL, a domain, HTTPS and persistent MySQL storage and configured GoHighLevel Media. PM2 does not install MySQL, issue certificates, run migrations or configure email for you.

The steps below target an Ubuntu VPS. Run application/PM2 commands as the **same non-root deployment user** each time. Only OS installation and the generated boot-service command need sudo. Do not mix `pm2` with `sudo pm2`: they manage different process lists and home directories.

### 1. Prepare Node.js, MySQL and the project

Install Node.js 24, npm, Git and MySQL 8 using the native installation prerequisites above. Verify your Node executable before installing PM2:

```bash
node --version
npm --version
command -v node
```

Node should report v24.x. With a system-wide Node installation:

```bash
sudo npm install --global pm2
pm2 --version
```

If Node is installed through a user-owned version manager, install PM2 without sudo in that user's Node environment. Its startup command will need that exact Node path; regenerate startup configuration after changing Node versions.

For a fresh checkout owned by your deployment user:

```bash
sudo mkdir -p /srv/operations
sudo chown "$USER":"$(id -gn)" /srv/operations
git clone https://github.com/Haris-khan-Durrani/immigiration-operation.git /srv/operations
cd /srv/operations
npm ci --omit=dev
cp .env.example .env
chmod 600 .env
nano .env
```

If the directory already contains the application, skip cloning/copying `.env`. Preserve the original encryption key and private files. If migrating from another supervisor, first stop its app process so it cannot compete for port 3000 or execute the same background jobs. Stop only this application's service/container, not other PM2 applications.

Create the native MySQL database/account using the SQL in [Native installation](#native-installation-without-docker). The Docker service name `mysql` will not work as a native database hostname unless separately configured to resolve.

Set at least these values in `.env`:

```dotenv
NODE_ENV=production
APP_URL=https://operations.example.com
HOST=127.0.0.1
PORT=3000
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=operations
MYSQL_USER=operations
MYSQL_PASSWORD=YOUR_DATABASE_ACCOUNT_PASSWORD
ENCRYPTION_KEY=YOUR_64_HEXADECIMAL_CHARACTER_KEY
UPLOAD_DIR=private-uploads
EMAIL_DELIVERY_ENABLED=false
```

Generate a key only for a new empty installation using the earlier Node command. Keep `.env` private. Leave INITIAL_ADMIN_EMAIL/PASSWORD blank for interactive creation. MYSQL_ROOT_PASSWORD is unnecessary for the native application connection.

```bash
mkdir -p private-uploads backups
chmod 700 private-uploads backups
npm run db:migrate
npm run admin:create
```

The admin command is for first installation only. PM2 startup does not run migrations or create an administrator.

### 2. Start using the included PM2 configuration

The repository includes [ecosystem.config.cjs](ecosystem.config.cjs). It starts the server directly with Node and loads `.env` through Node's `--env-file` flag. Its working directory is the project directory, so relative upload/backup paths resolve consistently.

```bash
cd /srv/operations
pm2 start ecosystem.config.cjs --only operations
pm2 status
pm2 logs operations --lines 100
```

Press Ctrl+C to leave the log viewer; the app continues running. Verify the local web listener:

```bash
curl -I http://127.0.0.1:3000/
```

The configuration uses one **fork-mode** process, disables file watching and automatically restarts after failure with a five-second delay. Keep one instance: the app includes its own maintenance/email timer. Do not enable cluster mode or use `pm2 scale` without implementing multi-worker coordination.

The `.cjs` extension is intentional because this repository uses ES modules while the PM2 configuration exports CommonJS. Do not rename it to `.js`. It contains no credentials; secrets stay in `.env`.

### 3. Put HTTPS in front of PM2

Follow [Domain and HTTPS](#domain-and-https) to point DNS and configure Caddy. The same proxy target, `127.0.0.1:3000`, works with PM2. Keep port 3000 private and open the application through `https://operations.example.com`.

The included PM2 configuration explicitly sets NODE_ENV=production, enabling Secure cookies even if `.env` says development. HTTP is only useful for checking the local listener; sign in over HTTPS. Use `npm start` with development configuration for local HTTP development instead of this production PM2 configuration.

Complete [workspace setup](#first-administrator-and-workspace-setup), [Contract Manager linking](#connect-contract-manager) and [email configuration](#email-and-crm). PM2 being online does not verify these integrations.

### 4. Automatically start after a server reboot

As the same deployment user:

```bash
pm2 startup systemd
```

PM2 prints a command beginning with `sudo env PATH=...`. Run **the exact generated command** on that server; it includes the correct username, home and Node/PM2 paths. Then save the current process list:

```bash
pm2 save
```

This saves all applications managed by that user's PM2 daemon, so review `pm2 status` first. The startup command installs the PM2 systemd boot service; it does not replace the need for `pm2 save`. Confirm the generated `pm2-YOUR_DEPLOY_USER` service is enabled:

```bash
sudo systemctl status pm2-YOUR_DEPLOY_USER
```

During an approved maintenance window, reboot and verify HTTPS and `pm2 status` afterward. Ensure MySQL and the HTTPS proxy also start at boot. If the PM2 daemon loses its process list, `pm2 resurrect` restores its last saved list; it is not a database restore.

After upgrading a version-manager Node installation, follow PM2's [startup instructions](https://pm2.keymetrics.io/docs/usage/startup/) to remove/regenerate the old startup hook with the new paths. Verify the ecosystem interpreter uses Node.js 24 and save the process list again.

### 5. Daily commands and configuration changes

| Task | Command |
| --- | --- |
| List managed apps | `pm2 status` |
| Inspect this app | `pm2 describe operations` |
| Follow logs | `pm2 logs operations --lines 100` |
| CPU/memory monitor | `pm2 monit` |
| Restart | `pm2 restart operations` |
| Stop temporarily | `pm2 stop operations` |
| Start after a stop | `pm2 restart operations` |
| Apply ecosystem/environment changes | `pm2 restart ecosystem.config.cjs --only operations --update-env` |
| Persist intended process list | `pm2 save` |

Edit `.env` then restart the process to reload it. Node reads that file at each start. Inherited shell/PM2 environment variables take precedence over values in the env file; the ecosystem deliberately supplies production NODE_ENV. Avoid exporting duplicate MYSQL_*, APP_URL or encryption variables in your shell. `--update-env` refreshes PM2's inherited environment; it does not override higher-precedence conflicting variables for you. Do not inspect/share full process environments because they may contain secrets.

Logs normally live in the deployment user's `~/.pm2/logs`. Keep them private and configure retention so the disk does not fill. Optional [PM2 log rotation](https://github.com/keymetrics/pm2-logrotate):

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 save
```

This installs a separate PM2 module, not an application dependency. PM2 guidance: [application configuration](https://pm2.keymetrics.io/docs/usage/application-declaration/) and [process management](https://pm2.keymetrics.io/docs/usage/process-management/).

### 6. Back up and update a PM2 installation

Use the same deployment user and project directory. Pause this app for a coordinated database/document snapshot:

```bash
cd /srv/operations
pm2 stop operations
npm run backup
pm2 restart operations
```

Copy the printed backup directory off-server and preserve `.env`/encryption key separately. If backup fails, inspect the error and restore service deliberately; commands are shown separately so failures are visible. Do not run the systemd-specific backup commands when PM2 manages this app.

For an update, take a successful backup first and record the existing commit:

```bash
cd /srv/operations
git rev-parse HEAD
pm2 stop operations
git pull --ff-only origin main
npm ci --omit=dev
npm run db:migrate
pm2 restart ecosystem.config.cjs --only operations --update-env
pm2 save
pm2 logs operations --lines 100
```

Stop if pull/install/migration fails; investigate before starting incompatible code. Verify HTTPS login, a known document and Settings activity afterward. There is a short maintenance outage; this guide does not promise zero-downtime deployment. Code rollback does not reverse schema changes: follow [Updates and rollback](#updates-and-rollback) and [Backups and recovery](#backups-and-recovery).

### 7. PM2 troubleshooting

| Symptom | Check |
| --- | --- |
| App repeatedly restarts / errored | Read `pm2 logs operations --lines 100`; check MySQL, encryption key, permissions and Node version. After correcting the cause, restart it. |
| EADDRINUSE | Another app, native service, Docker container or duplicate PM2 entry owns port 3000. Stop the conflicting Operations process; do not terminate unrelated services. |
| .env not found | Start the included ecosystem file, check its working directory and ensure the deployment user can read the root .env. |
| Wrong database/portal after editing .env | Check inherited PM2/shell overrides, use the same Unix user, then restart with the ecosystem configuration. |
| App missing from pm2 status | Confirm you are the original deployment user, not root or another SSH account. Each PM2 user has a separate process list. |
| Not restored after reboot | Run generated startup command and pm2 save; inspect the generated systemd service and old Node/version-manager paths. |
| App online but login fails over HTTP | Production Secure cookies need HTTPS. Configure the proxy and use the HTTPS domain. |
| Upload/backup permission error | The PM2 user needs write/traverse access to private directories and read access to .env. Do not make private storage public. |
| Disk fills with logs | Configure logrotate/retention and off-server backup retention. Check free space. |

These commands document Linux PM2 deployment; no PM2 daemon or live server was installed as part of writing the guide.

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

Backups contain encrypted application tables and any remaining legacy server document originals. GHL document bytes are not included; the referenced GHL files must remain available. They do not contain `.env`, the encryption key, TLS/server configuration. Preserve those separately.

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
| Handoff skipped | Inspect activity reason: source location, contract state, required PDFs. Excluded event IDs are remembered; after correcting policy use a new eventId to reconsider. Duplicate contracts remain excluded. |
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
- Proxy trust defaults to false. Docker/Caddy's header-removal example shares the proxy request budget. Native same-host Nginx can use TRUST_PROXY=loopback with overwritten forwarding headers for per-client accounting. Remote/container proxy trust requires a separately reviewed configuration; unrestricted true is not allowed.
- MySQL is required. SQLite/PostgreSQL are not drop-in alternatives.
- Keep database/document volumes, `.env` and the encryption key across container replacements. GitHub is not a data backup.
- Published categories are versioned; existing files retain their assigned checklist snapshot.
- No clients or default admin credentials are seeded. Migrations create schema/default workflow settings.
- The deployment commands are based on the repository and linked official documentation. Application unit/MySQL/browser checks have run locally; an actual VPS, DNS/certificate issuance and your real SMTP/CRM services still need verification on the target server.

Dossier handoffs accept all historical dates. The activation date applies only to the legacy summary protocol. A dossier previously excluded solely as Outside activation period can be resent with the same eventId after this update; other duplicate protections remain in place. Historical source data is not automatically fetched: Contract Manager must send or re-share it.

## Client file workspace and category maintenance

New clients includes a Review dossier action before initiation and an Initiated files section with Open file buttons afterward. Initiation opens Client overview with client details, category, owner, progress and source dossier links. Staff can work through Documents, Information, Tasks and Activity while the right-hand Conversations panel stays available. The panel contains client portal messages, email queue/CRM conversation access and a separate Internal notes tab; notes are private to staff. On narrower screens the conversation panel appears below the file content.

If intake email belongs to a staff account, initiation offers a correction step for the actual client email and a mandatory reason. The correction is audited, preserves the original source dossier and never changes the staff account. Corrections are allowed only before initiation. Confirm the address with the client/source counsellor before saving. Existing client logins can be reused for another file.

Administrators and managers can Edit category to change its name/parent. Hierarchy cycles are rejected. Published checklist requirements still use Create new draft, followed by editing/publishing; existing file requirements are preserved. Delete category requires explicit confirmation and is blocked for a category with subcategories or assigned client files. Unused category/template versions are deleted together and the action is audited.

## File statuses, reminders and expiry tracking

### Custom operational statuses

Staff can open **File statuses** in the management sidebar to create, rename and delete unused labels, for example Waiting for documents or Appointment booked. Assigned statuses cannot be deleted until files are moved to another status. These labels are separate from the system approval stages (Collecting, Approved, Submitted, Completed) and do not bypass checklist/review controls. Choose a label while initiating a file or change it in **Client file > Reminders & expiry**. The label is also shown in the staff file list and Client overview.

### Document upload reminders

At initiation choose Automatic document reminders: off, hourly, every 6/12 hours, daily, every 2/3 days, weekly, fortnightly or every 30 days. Existing files default to off. The same control is available in Reminders & expiry. A full selected interval passes before the first scheduled check; settings changes restart the schedule.

The existing one-minute maintenance loop checks due schedules and queues emails plus portal notifications for required, applicable document uploads that are missing or whose latest version was rejected. Pending-review/accepted documents, waived requirements and optional documents are excluded. Submitted/completed/cancelled files are excluded from upload reminders. A queued document reminder is rechecked immediately before sending; it is cancelled if uploads no longer need action, the file is closed or reminders are off.

Enable outgoing delivery in Email settings for actual sends. Delivery uses the saved SMTP/GHL provider. An unresolved queued/failed/uncertain reminder prevents repeated copies accumulating while email is paused or failing. Turning reminders off removes queued/failed unsent document reminders. Interrupted/uncertain sends still require provider verification.

### Expiry dates

In **Client file > Reminders & expiry > Add expiry date**, enter a name (passport, visa, permit, etc.), expiry date, alert lead time (0-365 days) and repeat interval (1-90 days). Multiple expiry items can be tracked per file. Alerts begin at the selected lead date, repeat at the selected interval and include one final expiry alert. Client email and portal notifications are queued; the file owner receives an in-app notification. Completed/cancelled files are excluded. Date thresholds follow the database server calendar; date-only values are preserved without timestamp conversion in backup/restore.

Use Remove to stop tracking an item; pending queued/failed expiry emails are removed. To correct an expiry date or alert interval, remove its tracking item and add the corrected item. An unresolved prior alert delays repeat alerts rather than accumulating copies. The system processes schedules while the app is running; it does not create a separate external cron service.

### Conversation panel

Client conversation shows saved portal messages chronologically, with author, message bubbles and timestamps. CRM history loads the latest 50 CRM messages when selected and offers Load older messages for previous pages, using the linked contact and configured location/token; missing permissions/connectivity are shown inline. Internal notes remain private to staff. Email compose and queued/sent/failed delivery records live in the collapsible Email & delivery history section. Refresh conversation loads current messages; this is not a live socket or background CRM mailbox sync.

### Upgrade an existing PM2 installation

This release adds database tables/columns and a cancelled-email state: migrations are required before using it. First take a coordinated backup **using the previous code version**, then update:

```bash
cd /www/operation/immigiration-operation
pm2 stop operations
git pull --ff-only origin main
npm run db:migrate
pm2 restart ecosystem.config.cjs --only operations --update-env
```

If migration fails, inspect the error before starting the updated app. Keep the original encryption key. Docker runs migrations at container startup when rebuilt. Refresh the browser with Ctrl+F5 after updating.

## Status colours, category design and client view

- **File statuses:** the create/edit dialog includes a colour picker. The selected colour is shown on status chips in the status list, file list and client overview. Renaming without supplying a colour through the API preserves it.
- **Categories:** each field has up/down sorting, Edit and Design actions. Edit changes only its label and description; an existing field type cannot be changed through either the UI or API. Add a new field if a different data type is needed. Design sets a section/group title and full/half width. Preview client checklist shows the form arrangement.
- New field types include Phone number, HTTPS website URL, single-choice radio buttons, section headings, instruction paragraphs and dividers, alongside the existing fields/uploads. Layout blocks do not count as required answers. Information fields use the configured arrangement; document uploads retain the document-review interface with page instructions above it.
- Editing/reordering/designing a published template creates a new draft. Publish after review. Existing files keep their saved checklist; use the explicit category migration action to apply a published template to an existing file.
- **Client files > Client view**, or **View as client** inside a file, opens a read-only client view. Staff can inspect documents, saved details, portal messages and client-visible activity without a client password or session switch. Exit client view restores the staff workspace. Uploads, forms and sending messages are disabled in this mode.
- Access is scope-checked and recorded as CLIENT_VIEW_PREVIEWED under Operations audit using the actual staff identity. No client login/session is created and internal notes, tasks, email queue records and source-only metadata are excluded. Document preview/download uses the staff identity and the existing private document-view audit, not a client login event.

This update adds a status-colour database column. Back up with the previous code, stop the app, pull main, run `npm run db:migrate`, then restart PM2. Preserve the encryption key.


### GoHighLevel primary document storage

New document uploads are buffered in memory and uploaded to GoHighLevel Media without writing a document to the Operations disk. Configure Settings → CRM connection with the sub-account location ID and private integration token with `medias.write` permission. Optionally save a Media folder ID in Document storage. Original bytes are preserved; uploads fail if GHL cannot confirm storage, with no local fallback. MySQL stores document metadata, checksums and GHL references. Previews/downloads still require an authorized Operations session and verify the downloaded bytes. GHL media URL access is controlled by GHL; an Operations login does not make the underlying media URL private.

Deploy this update with the schema migration before starting the app:

```bash
pm2 stop operations
git pull --ff-only origin main
npm run db:migrate
```

Existing files remain readable from their previous encrypted storage until migrated. After saving CRM credentials, stop Operations writes and run:

```bash
npm run storage:migrate
pm2 restart ecosystem.config.cjs --only operations --update-env
```

The migration uploads each existing original, downloads it to verify its size and SHA-256, records its GHL reference, then removes its encrypted server original. Failed verification preserves the original. Stop on errors and resolve before restarting migration. An interrupted migration after database commit may leave an unreferenced encrypted file on disk; inspect these before removing them. Existing backup archives are not deleted automatically. New backups include GHL metadata, not GHL document bytes, so restoring a backup requires the referenced GHL media to remain available. Do not delete those files in GHL. Contract Manager dossier links remain externally hosted links.


### Removing and replacing uploaded documents

Admins, managers and assigned Operations agents can use **Remove file** on the latest document of an open client file. A reason is required. The stored file is deleted from GHL (or legacy local storage), while the submission record and audit history remain marked Removed. A removed latest version makes the requirement incomplete; an earlier accepted version does not become current again. The client or Operations can upload a replacement, which starts as Pending review. Clients cannot remove files. Closed files must be reopened before changing documents. GHL deletion requires the configured location token with medias.write permission. A previously created backup may still contain legacy originals.


### Category instructions in the client portal

In Categories, select a service and choose **Client instructions**. Enter an introduction and important notes; blank bodies hide their respective panels. Use the visual rich text editor for headings, bold, italic, underline, bullet lists, numbered steps, paragraph alignment, HTTPS links and tables. Formatting appears directly as you type. Select text before formatting or inserting a link. Table actions can add/delete rows and columns or remove the table. Undo, redo and clear formatting are available. Then Save instructions. A published category automatically becomes a new draft when edited. Use Preview client checklist, then Publish category when ready. This preview includes upload requirements and instruction blocks; staff information fields remain in the staff workspace.

For document-specific guidance, use the field's Edit option and its formatted Description / instructions editor. Use Design → Section / group title to group related uploads, and the up/down controls to order them. Groups appear in the same saved order as the checklist. Existing condition rules and repeated applicant documents continue to apply.

The client sees the introduction and highlighted notes above the upload checklist, then the selected document’s detailed instructions beside its upload area. Category-wide introduction and important notes are read from the latest published category version on both existing and new files. Draft edits are not client-visible. Publishing notes updates the guidance without changing uploads, review statuses, or the saved checklist. Individual document instructions and other field definitions remain part of the file snapshot; changing those on an existing file requires explicit category migration, which replaces the active checklist. No PDF parsing/import or legal requirements are applied automatically.


Rich text editor updates require `npm ci --omit=dev` after pulling code. The install prepares locally hosted editor assets; no CDN, subscription or external editor account is required. Docker prepares the same assets during its build. Existing plain-text/Markdown instructions remain readable and are converted into visual content when opened for editing. Rich text is cleaned on save and render, with HTTPS-only links and no embedded images or executable content.


### Client document journey

The client portal and staff read-only client preview show a next-step message based on outstanding uploads, requested corrections, pending reviews and file closure. Upload counts and approval counts are separate: a pending document counts as uploaded and is labelled Under review. A Continue upload / Review changes shortcut selects an outstanding document. Category-wide instructions expand on request. Client document previews load when expanded, and replacement uploads for documents already under review are available under Uploaded the wrong file? Replace it. Operations review controls remain on the staff workspace.


### Viewing sent and queued emails

Open a client file and choose **Conversations → Email delivery**. The history shows subjects, recipients, queued dates, send dates, status and failures, with search and a status filter. View email opens its message body, attempts, next queued attempt, provider reference and any failure. Temporary passwords and activation tokens are masked in this staff view. Clients cannot access staff email history. Access is restricted to the same file/team scope and viewing an email is recorded in the Operations audit log.

Use **Expand view** to give conversations the full workspace width; **Back to file** restores the document workspace. The Email delivery view includes Compose an email and retries for failed/uncertain deliveries. Uncertain deliveries still require checking the email provider before retrying. Sent means accepted by the provider, not confirmed read or delivered to the inbox. Older sent emails may have no recorded send time; newly sent messages record it. The worker now saves the final reminder message before attempting delivery, so newly processed reminder history reflects its send-time content.

This update requires `npm run db:migrate` before restarting, to add the email send timestamp column. It does not automatically send queued messages; outgoing delivery remains controlled by Email delivery settings.


### Page URLs and refresh

Pages now have their own paths, including `/dashboard`, `/new-clients`, `/client-files`, `/categories`, `/file-statuses`, `/team`, `/settings`, `/my-tasks`, `/document-review` and `/activity-log`. A file tab uses `/client-files/42/documents`; selected documents and conversation tabs are stored in the query string. Staff read-only previews use `/client-files/42/client-view/documents`. Category selection uses `/categories/12`.

Refresh restores the selected page, file and tab; browser Back/Forward navigation and bookmarks work. Login resumes the requested page after authentication, subject to normal file/team permissions and mandatory password changes. Explicit logout uses `/login`. URLs contain navigation state only, without passwords, session tokens or email body content. The Express server serves the application shell for recognized page routes; API/asset routes retain their existing behavior. Keep Nginx forwarding these paths to the Operations Node application, as in the reverse-proxy configuration above. No database migration is needed for this routing update.


### Unified CRM and Operations conversation

The main Client conversation tab automatically combines the linked contact’s CRM history, Operations emails and portal updates in date order. Incoming/outgoing bubbles show their source, channel and delivery status. Queued emails remain labelled as queued. Sent Operations emails are deduplicated against CRM only when their provider message identifier matches a CRM message identifier; messages are not discarded merely because their text matches. Internal Operations notes stay on the separate private notes tab.

CRM history uses the configured GHL location/private token and the file’s linked GHL contact. The existing contact/location verification and file access scope apply. The token needs conversations.readonly and conversations/message.readonly permissions in addition to contact lookup access. The first page loads 50 CRM messages; use Load older CRM messages for earlier pages. The mixed thread includes the latest 200 Operations emails, while the Email delivery view retains the detailed outbox history. Loaded CRM pages are cached for up to one minute per user, file and contact, preserving older pages while working. Refresh conversation bypasses that cache. This is on-demand loading, not a background real-time subscription. If CRM is unavailable, the thread still shows Operations content with the connection error.

The bottom composer offers Email (queued through the configured provider) and Portal update (recorded in the client activity log). It does not send SMS/WhatsApp messages. CRM attachments are shown as links; expired or provider-protected attachment URLs still follow GHL access rules. No attachments are downloaded into Operations server storage by this conversation feature.


The conversation tab bar now contains only Client conversation (the combined CRM and Operations thread) and Internal notes. The former separate Emails and CRM history tabs are removed. Use the Email delivery button in the conversation header for outbox search, filters, message details and retries; Back to conversation returns to the combined thread. Older CRM-only links open the combined conversation.


### Confirming document storage

The staff document view labels each version Stored in GoHighLevel Media or Legacy server file — migration needed. Verify storage downloads a GHL-stored file in memory and checks its original size and SHA-256, then shows the provider Media ID. It does not create a disk copy. The Operations `/api/documents/:id/file` URL remains an authenticated delivery endpoint for either provider; it is not proof of local disk storage. New GHL uploads preserve the original filename within a name such as OPS-42-v1-Passport.pdf so staff can locate them in Media. Existing uploads retain their previously assigned provider names. A rejected or unconfirmed GHL upload fails without creating a document record or falling back to local disk. Run the documented storage migration to transfer legacy server files.


Client files now includes a Completion column with percentage, progress bar and completed/required counts. Staff completion uses the same checklist rules as the file detail: accepted latest document versions and valid required answers count, while optional, waived and non-applicable requirements do not block completion. Client list completion counts their applicable required documents only. Values are calculated from current requirements and document review states without a separate stored percentage. Category action colours distinguish delete/remove (red), edit (blue), design (purple) and instructions/preview (teal).

### Delete a client file

In **Client files**, choose **Delete**. The popup warns **This action cannot be undone**. Enter an active administrator’s email, password and a reason, then verify. After verification, a mandatory five-second countdown runs before **Permanently delete file** becomes available. Click it to confirm. Closing the popup cancels the action. The server enforces the wait and the authorization expires after two minutes; Operations passwords cannot authorize deletion.

This permanently deletes the file and its related checklist, document metadata, case activity, tasks, emails, reminders, invitations, notifications and intake records from the Operations database. A minimal application audit entry records the file ID, requesting user, approving administrator and reason. GHL Media documents, external CRM records, user accounts and existing backups are not erased. Emails already sent cannot be recalled. Files with an email currently sending must wait for delivery to finish.

### Notifications and daily tasks

The bell shows the unread count for the last 30 days. Opening an individual notification or marking it read reduces the count. Completing a task clears its related alerts; reviewing a document clears its review alert. Opening the notification page alone does not mark every item read. Counts refresh when navigating and every minute while the app is visible.

Every staff page shows a compact, collapsed task strip only when the signed-in user has overdue tasks or tasks due today (Asia/Dubai). Expand it to see client names and file links. The strip disappears when no tasks need attention. Overdue tasks are highlighted red with their due time. The panel shows up to three items with All tasks for the rest. Completed tasks are permanently removed from the tasks table, with a TASK_COMPLETED case activity entry retained. The scheduled maintenance job deletes notifications older than 30 days and cleans up legacy completed tasks; keep the documented worker running for database cleanup.

### Review application answers

Required fields and required documents both count in application completion. A submitted answer stays pending until Operations accepts it from the file’s **Information** tab. Use **Request correction** to reject an answer with a reason, visible beside the client’s field and in client activity. Clients save revised answers from **Application details** beside uploads. Editing an accepted answer resets it to pending and lowers completion until accepted again; unchanged accepted answers remain accepted. Optional, waived and inapplicable fields do not lower completion. Staff client preview remains read only.

Run `npm run db:migrate` before restarting after this update. The migration preserves existing saved answers as accepted, matching the previous behavior; new and changed answers require review. Existing published/client checklist versions remain unchanged.

### File review queue

**File review** combines pending field answers and the latest pending document uploads for files you can access. Choose **Review** to open the relevant answer in Information or the selected document. Accept or request correction there; reviewed items leave the queue until a new answer or upload is submitted. Blank, invalid, waived, hidden and closed-file items are excluded. The dashboard File review count includes both item types. The page URL is `/file-review`; old `/document-review` links still work.

### Add previous clients manually

Operations staff can choose **Add client** in **New clients** or **Client files** to onboard a previous client without a Contract Manager handoff. Enter their name and email, select a published category, and optionally enter phone, nationality, internal notes, a collection deadline, document reminder frequency and file status. Managers/admins can choose an owner within their permitted scope; agents create files assigned to themselves. An optional GHL contact ID is verified against the configured CRM location. SMTP can deliver login emails without a linked GHL contact.

**Create file & email login** opens the file immediately in Client files and queues portal credentials. Existing client accounts keep their password; new clients receive a temporary password that must be changed. Staff emails cannot be used as client accounts. An existing open file for the same email/category is rejected to avoid duplicate onboarding. Manual additions are recorded in the application activity log. Contract Manager handoffs continue through the existing New clients flow.

While adding a previous client, check **Stop client notifications** to create the file silently. No portal login email, automated email, document reminder, expiry email or client notification is sent for that file. Existing client logins remain valid; a new client gets portal access only after staff re-enable notifications and send an invitation. Internal staff alerts and the file activity log continue. Change the option later in **Reminders & expiry → Stop client notifications**. Pausing also cancels queued client emails and clears that file’s client notification alerts; sent emails cannot be recalled. An email already sending must finish before pausing. Re-enabling does not resend old cancelled emails automatically. Run `npm run db:migrate` for this per-file preference.
