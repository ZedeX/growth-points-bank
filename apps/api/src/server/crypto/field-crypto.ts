import { createCipheriv, createDecipheriv, randomBytes, createHmac } from 'crypto';

const MASTER_KEY = process.env.DATA_ENCRYPTION_KEY
  ? Buffer.from(process.env.DATA_ENCRYPTION_KEY, 'base64')
  : Buffer.alloc(32, 0);  // dev fallback

if (MASTER_KEY.length !== 32) {
  console.warn('[crypto] DATA_ENCRYPTION_KEY must be 32 bytes (base64-encoded). Using fallback.');
}

function deriveRowKey(tableName: string, rowId: string): Buffer {
  const info = Buffer.from(`${tableName}:${rowId}`);
  const prk = createHmac('sha256', MASTER_KEY).update(Buffer.from(tableName)).digest();
  const okm = createHmac('sha256', prk).update(Buffer.concat([Buffer.from([1]), info])).digest();
  return okm.subarray(0, 32);
}

export function encryptField(tableName: string, rowId: string, plaintext: string | null): string | null {
  if (plaintext === null || plaintext === undefined) return null;
  const key = deriveRowKey(tableName, rowId);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString('base64');
}

export function decryptField(tableName: string, rowId: string, encrypted: string | null): string | null {
  if (encrypted === null || encrypted === undefined) return null;
  try {
    const key = deriveRowKey(tableName, rowId);
    const buf = Buffer.from(encrypted, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(buf.length - 16);
    const ciphertext = buf.subarray(12, buf.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    return null;
  }
}
