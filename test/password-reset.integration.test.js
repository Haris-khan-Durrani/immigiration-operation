import {test} from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rm} from 'node:fs/promises';
import path from 'node:path';

test('Password reset flow: request, token verification, password update, and login with new password', {skip: process.env.RUN_MYSQL_TESTS !== 'true'}, async () => {
  const name = 'ops_test_reset_' + randomBytes(5).toString('hex');
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD
  });

  let pool, server;
  const uploadDir = path.resolve('.test-uploads-' + name);

  try {
    await connection.query('CREATE DATABASE ' + name);
    process.env.MYSQL_DATABASE = name;
    process.env.UPLOAD_DIR = uploadDir;
    process.env.NODE_ENV = 'test';
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
    process.env.CONTRACT_WEBHOOK_SECRET = randomBytes(32).toString('hex');
    process.env.APP_URL = 'http://127.0.0.1:3000';

    const migrate = spawnSync(process.execPath, ['server/migrate.js'], {env: process.env, encoding: 'utf8'});
    assert.equal(migrate.status, 0, migrate.stderr);

    const {db} = await import('../server/db.js');
    pool = db;
    const {hashPassword} = await import('../server/auth.js');
    const {app} = await import('../server/index.js');
    const {decrypt} = await import('../server/crypto.js');

    const initialPassword = 'initial-secure-pass-123';
    const newPassword = 'new-updated-pass-456';
    const userEmail = 'reset.test@example.com';
    const hash = await hashPassword(initialPassword);

    await pool.execute(
      "INSERT INTO users (name, email, password_hash, role) VALUES ('Reset Tester', ?, ?, 'AGENT')",
      [userEmail, hash]
    );

    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;

    async function req(route, method = 'GET', body = null) {
      const res = await fetch(base + '/api/' + route, {
        method,
        headers: {
          'X-Ops-Request': '1',
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
      });
      const data = await res.json();
      return {status: res.status, data};
    }

    // 1. Initial login works
    const loginInitial = await req('auth/login', 'POST', {email: userEmail, password: initialPassword});
    assert.equal(loginInitial.status, 200);

    // 2. Request forgot-password
    const forgotRes = await req('auth/forgot-password', 'POST', {email: userEmail});
    assert.equal(forgotRes.status, 200);
    assert.equal(forgotRes.data.sent, true);

    // 3. Verify record in password_resets & email in outbox
    const [resets] = await pool.query('SELECT * FROM password_resets WHERE used_at IS NULL');
    assert.equal(resets.length, 1);

    const [outbox] = await pool.query("SELECT * FROM email_outbox WHERE event_key LIKE 'password-reset:%'");
    assert.equal(outbox.length, 1);
    const payload = JSON.parse(decrypt(outbox[0].payload_encrypted));
    assert.equal(payload.emailTo, userEmail);
    assert.match(payload.message, /\?reset=[a-f0-9]{64}/);

    const resetToken = payload.message.match(/\?reset=([a-f0-9]{64})/)[1];

    // 4. Verify reset token
    const verifyValid = await req('auth/verify-reset-token?token=' + resetToken);
    assert.equal(verifyValid.status, 200);
    assert.equal(verifyValid.data.valid, true);
    assert.equal(verifyValid.data.email, userEmail);

    const verifyBogus = await req('auth/verify-reset-token?token=' + 'a'.repeat(64));
    assert.equal(verifyBogus.status, 400);
    assert.equal(verifyBogus.data.valid, false);

    // 5. Complete password reset
    const resetRes = await req('auth/reset-password', 'POST', {token: resetToken, password: newPassword});
    assert.equal(resetRes.status, 200);
    assert.equal(resetRes.data.reset, true);

    // 6. Token cannot be reused
    const reuseRes = await req('auth/reset-password', 'POST', {token: resetToken, password: newPassword});
    assert.equal(reuseRes.status, 400);

    // 7. Old password no longer works
    const loginOld = await req('auth/login', 'POST', {email: userEmail, password: initialPassword});
    assert.equal(loginOld.status, 401);

    // 8. New password works
    const loginNew = await req('auth/login', 'POST', {email: userEmail, password: newPassword});
    assert.equal(loginNew.status, 200);
    assert.equal(loginNew.data.email, userEmail);

  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    await connection.query('DROP DATABASE IF EXISTS ' + name);
    await connection.end();
    await rm(uploadDir, {recursive: true, force: true}).catch(() => {});
  }
});
