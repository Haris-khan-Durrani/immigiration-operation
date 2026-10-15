import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
function key() {
  if (!/^[a-f0-9]{64}$/i.test(process.env.ENCRYPTION_KEY || '')) throw new Error('ENCRYPTION_KEY must contain 64 hexadecimal characters');
  return Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
}
export function encrypt(value) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(b => b.toString('base64')).join('.');
}
export function decrypt(value) {
  const [iv, tag, ciphertext] = value.split('.').map(v => Buffer.from(v, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', key(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8');
}
