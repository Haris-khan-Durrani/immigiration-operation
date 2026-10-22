import {Router} from 'express';
import {randomBytes, createHash} from 'node:crypto';
import {rateLimit} from 'express-rate-limit';
import {db} from './db.js';
import {hashPassword} from './auth.js';
import {fail} from './domain.js';
import {transaction} from './workflow.js';
import {encrypt} from './crypto.js';
import {portalBase} from './connection.js';
import {emailSettings, deliverEmail} from './email.js';

export const passwordResetRoutes = Router();

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function validatePassword(password) {
  return typeof password === 'string' && password.length >= 12 && password.length <= 128;
}

const forgotLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: {error: 'Too many password reset requests. Please wait a few minutes before trying again.'}
});

const resetLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  message: {error: 'Too many reset attempts. Please wait a few minutes before trying again.'}
});

passwordResetRoutes.post('/auth/forgot-password', forgotLimit, async (req, res) => {
  const {email} = req.body || {};
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({error: 'Please enter a valid email address.'});
  }

  const cleanEmail = email.trim().toLowerCase();
  const [users] = await db.execute('SELECT id, name, email, role, active FROM users WHERE email=? AND active=1', [cleanEmail]);

  if (users.length) {
    const user = users[0];
    const token = randomBytes(32).toString('hex');
    const tokenDigest = hashToken(token);

    await transaction(async c => {
      await c.execute('UPDATE password_resets SET used_at=NOW() WHERE user_id=? AND used_at IS NULL', [user.id]);
      await c.execute(
        'INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))',
        [tokenDigest, user.id]
      );
      await c.execute(
        'INSERT INTO audit_events (actor, action, details) VALUES (?, ?, ?)',
        [user.email, 'PASSWORD_RESET_REQUESTED', JSON.stringify({userId: user.id})]
      );
    });

    const portalUrl = await portalBase();
    const resetUrl = new URL('/?reset=' + token, portalUrl).href;

    const subject = 'Reset your Operations password';
    const message = `Hello ${user.name},\n\nA password reset request was received for your Operations workspace account (${user.email}).\n\nClick the link below to choose a new password (valid for 1 hour):\n${resetUrl}\n\nIf you did not request this, you can safely ignore this email. Your password will remain unchanged.\n\nOperations workspace`;

    const html = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #233539; line-height: 1.6;">
  <h2 style="color: #137f75; margin-top: 0; font-size: 20px;">Reset your Operations password</h2>
  <p>Hello ${user.name},</p>
  <p>A password reset request was received for your account (<strong>${user.email}</strong>).</p>
  <p style="margin: 28px 0;">
    <a href="${resetUrl}" style="background-color: #137f75; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block;">Reset your password &rarr;</a>
  </p>
  <p style="color: #657d84; font-size: 13px;">This link is valid for 1 hour. If the button above does not work, copy and paste this URL into your browser:</p>
  <p style="color: #657d84; font-size: 12px; word-break: break-all;"><a href="${resetUrl}" style="color: #137f75;">${resetUrl}</a></p>
  <hr style="border: 0; border-top: 1px solid #e2ece8; margin: 24px 0;" />
  <p style="color: #8c9fa4; font-size: 12px; margin-bottom: 0;">If you did not request a password reset, you can safely ignore this email. Your password will not change.</p>
</div>`;

    let contactId = null;
    let caseId = null;
    if (user.role === 'CLIENT') {
      const [cases] = await db.execute('SELECT id, ghl_contact_id FROM cases WHERE client_user_id=? ORDER BY id DESC LIMIT 1', [user.id]);
      if (cases.length) {
        caseId = cases[0].id;
        contactId = cases[0].ghl_contact_id || null;
      }
    }

    const eventKey = `password-reset:${user.id}:${Date.now()}`;
    const payload = {emailTo: user.email, subject, message, html};

    await db.execute(
      'INSERT INTO email_outbox (case_id, recipient_contact_id, payload_encrypted, event_key) VALUES (?, ?, ?, ?)',
      [caseId, contactId, encrypt(JSON.stringify(payload)), eventKey]
    );

    const config = await emailSettings();
    if (config.enabled) {
      try {
        const result = await deliverEmail(contactId, payload, config);
        await db.execute(
          "UPDATE email_outbox SET status='SENT', sent_at=NOW(), provider_message_id=?, last_error=NULL WHERE event_key=?",
          [(result?.messageId || result?.emailMessageId || '').slice(0, 120) || null, eventKey]
        );
      } catch {
        // Retained as QUEUED in outbox for background worker retry
      }
    }
  }

  res.json({
    sent: true,
    message: 'If an active account exists with that email, a password reset link has been sent. Please check your inbox.'
  });
});

passwordResetRoutes.get('/auth/verify-reset-token', resetLimit, async (req, res) => {
  const token = req.query.token;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).json({valid: false, error: 'This password reset link is invalid.'});
  }

  const tokenDigest = hashToken(token);
  const [rows] = await db.execute(
    'SELECT pr.expires_at, pr.used_at, u.email, u.name, u.active FROM password_resets pr JOIN users u ON u.id = pr.user_id WHERE pr.token_hash = ?',
    [tokenDigest]
  );

  if (!rows.length || rows[0].used_at !== null || new Date(rows[0].expires_at) <= new Date()) {
    return res.status(400).json({valid: false, error: 'This password reset link is invalid or has expired. Please request a new one.'});
  }

  if (!rows[0].active) {
    return res.status(403).json({valid: false, error: 'This account is currently disabled. Please contact your Operations team.'});
  }

  res.json({valid: true, email: rows[0].email, name: rows[0].name});
});

passwordResetRoutes.post('/auth/reset-password', resetLimit, async (req, res) => {
  const {token, password} = req.body || {};
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    fail('Invalid password reset token.', 400);
  }
  if (!validatePassword(password)) {
    fail('Password must be between 12 and 128 characters.', 400);
  }

  const tokenDigest = hashToken(token);
  let userEmail = '';

  await transaction(async c => {
    const [rows] = await c.execute(
      'SELECT pr.*, u.email, u.active FROM password_resets pr JOIN users u ON u.id = pr.user_id WHERE pr.token_hash = ? FOR UPDATE',
      [tokenDigest]
    );

    if (!rows.length || rows[0].used_at !== null) {
      fail('This password reset link is invalid or has already been used.', 400);
    }

    const reset = rows[0];
    if (new Date(reset.expires_at) <= new Date()) {
      fail('This password reset link has expired. Please request a new one.', 400);
    }

    if (!reset.active) {
      fail('This account is disabled. Please contact your Operations team.', 403);
    }

    userEmail = reset.email;
    const newHash = await hashPassword(password);

    await c.execute('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?', [newHash, reset.user_id]);
    await c.execute('UPDATE password_resets SET used_at=NOW() WHERE token_hash=?', [tokenDigest]);
    await c.execute('DELETE FROM sessions WHERE user_id=?', [reset.user_id]);
    await c.execute(
      'INSERT INTO audit_events (actor, action, details) VALUES (?, ?, ?)',
      [reset.email, 'PASSWORD_RESET_COMPLETED', JSON.stringify({userId: reset.user_id})]
    );
  });

  res.clearCookie('ops_session', {path: '/'});
  res.json({
    reset: true,
    email: userEmail,
    message: 'Your password has been reset successfully. You can now sign in with your new password.'
  });
});
