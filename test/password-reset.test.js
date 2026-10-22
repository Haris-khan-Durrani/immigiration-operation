import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashToken, validatePassword} from '../server/password-reset.js';
import {hashPassword, verifyPassword} from '../server/auth.js';

test('validatePassword enforces 12-128 character password constraints', () => {
  assert.equal(validatePassword('short'), false);
  assert.equal(validatePassword('12345678901'), false); // 11 chars
  assert.equal(validatePassword('123456789012'), true); // 12 chars
  assert.equal(validatePassword('a'.repeat(128)), true); // 128 chars
  assert.equal(validatePassword('a'.repeat(129)), false); // 129 chars
  assert.equal(validatePassword(null), false);
  assert.equal(validatePassword(undefined), false);
  assert.equal(validatePassword(123456789012), false);
});

test('hashToken computes deterministic 64-char hex SHA-256 digest', () => {
  const tokenA = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const tokenB = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
  const hashA = hashToken(tokenA);
  const hashB = hashToken(tokenB);

  assert.equal(typeof hashA, 'string');
  assert.equal(hashA.length, 64);
  assert.match(hashA, /^[a-f0-9]{64}$/);
  assert.equal(hashA, hashToken(tokenA));
  assert.notEqual(hashA, hashB);
});

test('resetting password with new hash verifies correctly and invalidates old password', async () => {
  const initialPassword = 'initial-secure-password-123';
  const newPassword = 'new-secure-password-456';

  const initialHash = await hashPassword(initialPassword);
  assert.equal(await verifyPassword(initialPassword, initialHash), true);

  const newHash = await hashPassword(newPassword);
  assert.equal(await verifyPassword(newPassword, newHash), true);
  assert.equal(await verifyPassword(initialPassword, newHash), false);
});
